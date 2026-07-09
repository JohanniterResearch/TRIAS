using Ambulanzsystem.Api.Config;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Endpoints;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

StartupValidation.Validate(builder.Configuration, builder.Environment);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default"))
        .UseSnakeCaseNamingConvention());

var app = builder.Build();

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

app.UseHttpsRedirection();
app.UseAuthorization();

app.MapControllers();
app.MapHealthEndpoint();

app.Run();

public partial class Program; // exposed for WebApplicationFactory in integration tests
