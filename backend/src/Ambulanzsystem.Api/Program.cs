using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Config;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Endpoints;
using Ambulanzsystem.Api.Filters;
using Ambulanzsystem.Api.Middleware;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

StartupValidation.Validate(builder.Configuration, builder.Environment);

builder.Services
    .AddControllers(options => options.Filters.Add<AuditReadFilter>())
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(
        new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    // Both Compose definitions bind the API to loopback, so production traffic can only arrive
    // through a host-local reverse proxy. Trust exactly one forwarding hop; otherwise Docker's
    // bridge source address collapses every client into one rate-limit partition.
    options.KnownNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
        .UseSnakeCaseNamingConvention());

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.AddSingleton<TokenService>();
builder.Services.AddScoped<RefreshTokenService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<SessionValidator>();
builder.Services.AddSingleton<MetricsService>();
builder.Services.AddSignalR();
builder.Services.AddSingleton<RealtimePublisher>();
builder.Services.AddSingleton<SceneSubscriptions>();
builder.Services.AddSingleton<RealtimePatientMapper>();
builder.Services.AddScoped<SceneNotifier>();
builder.Services.AddHostedService<RealtimeDispatcher>();

var jwtSecret = builder.Configuration["Jwt:Secret"]!;
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Without this, inbound "sub" gets remapped to the legacy XML-schema claim URI and every
        // FindFirst(JwtRegisteredClaimNames.Sub) call downstream silently returns null.
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = JwtOptions.Issuer,
            ValidateAudience = true,
            ValidAudience = JwtOptions.Audience,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromSeconds(30),
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = SecurityStampValidation.OnTokenValidated,
            // SignalR/WebSocket clients can't set an Authorization header, so the token travels
            // as a query string param for hub requests only (contract/schemas/realtime-messages.md).
            OnMessageReceived = context =>
            {
                if (context.Request.Path.StartsWithSegments("/hubs")
                    && context.Request.Query.TryGetValue("access_token", out var token))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            },
        };
    });

builder.Services.AddAuthorization(options => options.AddAmbulanzsystemPolicies());
builder.Services.AddAmbulanzsystemRateLimiting();
builder.Services.AddAmbulanzsystemCors(builder.Configuration, builder.Environment);

var app = builder.Build();
app.UseForwardedHeaders();

// One-shot migration + seed step must complete before the app serves traffic
// (recreation spec §1). Fail hard on error rather than serving against a stale schema.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
    await DataSeeder.SeedAsync(db, app.Configuration, app.Environment);
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

if (app.Environment.IsProduction())
{
    app.UseHsts();
}

var spaIndex = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
app.UseAmbulanzsystemSecurityHeaders();
if (File.Exists(spaIndex))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
}

app.UseHttpsRedirection();
app.UseAmbulanzsystemCorrelationId();

app.UseCors(CorsPolicy.Name);
app.UseMiddleware<MetricsMiddleware>();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<SceneHub>("/hubs/scene", options => options.CloseOnAuthenticationExpiration = true);
app.MapHealthEndpoint();
if (File.Exists(spaIndex))
{
    app.MapFallback(async context =>
    {
        if (context.Request.Path.StartsWithSegments("/api")
            || context.Request.Path.StartsWithSegments("/hubs")
            || context.Request.Path.StartsWithSegments("/health"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        await context.Response.SendFileAsync(spaIndex);
    });
}

app.Run();

public partial class Program; // exposed for WebApplicationFactory in integration tests
