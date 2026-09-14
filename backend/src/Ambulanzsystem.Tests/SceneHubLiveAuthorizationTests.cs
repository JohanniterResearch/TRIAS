using System.Collections.Concurrent;
using System.Data.Common;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Ambulanzsystem.Tests;

public class SceneHubLiveAuthorizationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private HubConnection Connect(string token, WebApplicationFactory<Program>? app = null) => new HubConnectionBuilder()
        .WithUrl(new Uri((app ?? factory).Server.BaseAddress, "/hubs/scene"), options =>
        {
            options.Transports = HttpTransportType.WebSockets;
            options.SkipNegotiation = true;
            options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            options.WebSocketFactory = async (context, cancellationToken) =>
            {
                var client = (app ?? factory).Server.CreateWebSocketClient();
                client.ConfigureRequest = request => request.Headers.Authorization = $"Bearer {token}";
                return await client.ConnectAsync(context.Uri, cancellationToken);
            };
        }).Build();

    [Theory]
    [InlineData("user-revoked")]
    [InlineData("password-changed")]
    [InlineData("password-required")]
    [InlineData("orphan-event")]
    [InlineData("qr-revoked")]
    [InlineData("qr-expired")]
    [InlineData("scene-closed")]
    public async Task EstablishedWebSocket_RevalidatesDeliveryAndRejoin(string invalidation)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var scene = new OperationScene { Name = $"live-auth-{Guid.NewGuid():N}", Active = true };
        var responder = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder };
        var admin = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Admin };
        db.AddRange(scene, responder, admin);
        await db.SaveChangesAsync();
        var qr = new QrCodeLogin { QrToken = Guid.NewGuid().ToString(), EventSceneId = scene.Id, ExpiresAt = DateTime.UtcNow.AddHours(1) };
        db.Add(qr);
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<TokenService>();
        var token = invalidation.StartsWith("qr-")
            ? tokens.IssueQrToken(qr.Id, scene.Id, qr.ExpiresAt!.Value).Token
            : tokens.IssueUserToken(responder).Token;
        await using var denied = Connect(token);
        await using var allowed = Connect(tokens.IssueUserToken(admin).Token);
        var deniedMessages = new ConcurrentQueue<JsonElement>();
        denied.On<JsonElement>("Probe", deniedMessages.Enqueue);
        var delivered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        allowed.On<JsonElement>("Probe", _ => delivered.TrySetResult());
        await denied.StartAsync();
        await allowed.StartAsync();
        await denied.InvokeAsync("JoinScene", scene.Id);
        await allowed.InvokeAsync("JoinScene", scene.Id);

        switch (invalidation)
        {
            case "user-revoked": responder.RevokedAt = DateTime.UtcNow; break;
            case "password-changed": responder.SecurityStamp = Guid.NewGuid().ToString(); break;
            case "password-required": responder.RequiresPasswordChange = true; break;
            case "orphan-event": responder.AccountType = AccountType.Event; break;
            case "qr-revoked": qr.RevokedAt = DateTime.UtcNow; break;
            case "qr-expired": qr.ExpiresAt = DateTime.UtcNow.AddMinutes(-1); break;
            case "scene-closed": scene.Active = false; break;
        }
        await db.SaveChangesAsync();
        factory.Services.GetRequiredService<RealtimePublisher>().Publish(SceneHub.GroupName(scene.Id), "Probe", new { scene.Id });
        await delivered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await Assert.ThrowsAsync<HubException>(() => denied.InvokeAsync("JoinScene", scene.Id));
        Assert.Empty(deniedMessages);
        Assert.Equal(HubConnectionState.Connected, allowed.State);
    }
    [Fact]
    public async Task EstablishedWebSocket_ClosesAtTokenExpiry()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder };
        db.Add(user);
        await db.SaveChangesAsync();
        var issued = scope.ServiceProvider.GetRequiredService<TokenService>().IssueUserToken(user);
        var claims = new JwtSecurityTokenHandler().ReadJwtToken(issued.Token).Claims.Where(c => c.Type != "exp");
        var secret = scope.ServiceProvider.GetRequiredService<IOptions<JwtOptions>>().Value.Secret;
        var jwt = new JwtSecurityToken(JwtOptions.Issuer, JwtOptions.Audience, claims,
            expires: DateTime.UtcNow.AddSeconds(3),
            signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)), SecurityAlgorithms.HmacSha256));
        await using var connection = Connect(new JwtSecurityTokenHandler().WriteToken(jwt));
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };
        await connection.StartAsync();
        await closed.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(HubConnectionState.Disconnected, connection.State);
    }

    [Fact]
    public async Task AuthorizationDatabaseFailure_SuppressesRecipientAndRemainsUnhealthyAfterValidRecipient()
    {
        var failure = new FailUserLookup();
        using var app = factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(options => options
                .UseNpgsql(TestDatabaseIsolation.TestConnectionString).UseSnakeCaseNamingConvention()
                .AddInterceptors(failure));
        }));
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var scene = new OperationScene { Name = $"failure-{Guid.NewGuid():N}", Active = true };
        var first = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder };
        var second = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder };
        db.AddRange(scene, first, second);
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<TokenService>();
        await using var denied = Connect(tokens.IssueUserToken(first).Token, app);
        await using var allowed = Connect(tokens.IssueUserToken(second).Token, app);
        var deniedMessages = new ConcurrentQueue<JsonElement>();
        denied.On<JsonElement>("Probe", deniedMessages.Enqueue);
        var delivered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        allowed.On<JsonElement>("Probe", _ => delivered.TrySetResult());
        await denied.StartAsync();
        await allowed.StartAsync();
        await denied.InvokeAsync("JoinScene", scene.Id);
        await allowed.InvokeAsync("JoinScene", scene.Id);
        failure.UserId = first.Id;
        var publisher = app.Services.GetRequiredService<RealtimePublisher>();
        publisher.Publish(SceneHub.GroupName(scene.Id), "Probe", new { scene.Id });
        await delivered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (publisher.DispatcherHealthy) await Task.Delay(10, deadline.Token);
        await Assert.ThrowsAsync<HubException>(() => denied.InvokeAsync("JoinScene", scene.Id));
        Assert.Empty(deniedMessages);
        Assert.False(publisher.DispatcherHealthy);
        failure.UserId = null;
    }

    [Fact]
    public async Task ExpiredSubscription_IsDeniedWhileWebSocketTransportRemainsOpen()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var scene = new OperationScene { Name = $"expiry-{Guid.NewGuid():N}", Active = true };
        var user = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder };
        var observer = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Admin };
        db.AddRange(scene, user, observer);
        await db.SaveChangesAsync();
        var tokens = scope.ServiceProvider.GetRequiredService<TokenService>();
        await using var expired = Connect(tokens.IssueUserToken(user).Token);
        await using var allowed = Connect(tokens.IssueUserToken(observer).Token);
        var deniedMessages = new ConcurrentQueue<JsonElement>();
        expired.On<JsonElement>("Probe", deniedMessages.Enqueue);
        var delivered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        allowed.On<JsonElement>("Probe", _ => delivered.TrySetResult());
        await expired.StartAsync();
        await allowed.StartAsync();
        await expired.InvokeAsync("JoinScene", scene.Id);
        await allowed.InvokeAsync("JoinScene", scene.Id);

        // Expire the retained authorization identity independently of SignalR's close timer.
        // This proves delivery fails closed even while the original WebSocket remains established.
        var subscriptions = factory.Services.GetRequiredService<SceneSubscriptions>();
        var subscription = subscriptions.ForGroup(SceneHub.GroupName(scene.Id))
            .Single(s => s.Principal.FindFirstValue("sub") == user.Id.ToString());
        var identity = (ClaimsIdentity)subscription.Principal.Identity!;
        identity.RemoveClaim(identity.FindFirst("exp")!);
        identity.AddClaim(new Claim("exp", DateTimeOffset.UtcNow.AddSeconds(-1).ToUnixTimeSeconds().ToString()));
        factory.Services.GetRequiredService<RealtimePublisher>().Publish(SceneHub.GroupName(scene.Id), "Probe", new { scene.Id });
        await delivered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await expired.InvokeAsync("LeaveScene", scene.Id);
        Assert.Empty(deniedMessages);
        Assert.Equal(HubConnectionState.Connected, expired.State);
        Assert.DoesNotContain(subscriptions.ForGroup(SceneHub.GroupName(scene.Id)), s => s.ConnectionId == subscription.ConnectionId);
    }

    [Theory]
    [InlineData("Development", true, true, SessionValidity.Valid)]
    [InlineData("Development", false, true, SessionValidity.PasswordChangeRequired)]
    [InlineData("Production", true, true, SessionValidity.PasswordChangeRequired)]
    [InlineData("Development", true, false, SessionValidity.PasswordChangeRequired)]
    public async Task ForcedPasswordChange_BypassRequiresDevelopmentFeatureAndClaim(
        string environment, bool enabled, bool claim, SessionValidity expected)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = new User { Username = Guid.NewGuid().ToString(), PasswordHash = "unused", Role = Role.Responder, RequiresPasswordChange = true };
        db.Add(user);
        await db.SaveChangesAsync();
        var token = scope.ServiceProvider.GetRequiredService<TokenService>().IssueUserToken(user, claim).Token;
        var principal = new ClaimsPrincipal(new ClaimsIdentity(new JwtSecurityTokenHandler().ReadJwtToken(token).Claims, "Bearer"));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Features:EnableDevLogin"] = enabled.ToString(),
        }).Build();
        var validator = new SessionValidator(db, new TestEnvironment { EnvironmentName = environment }, config);
        Assert.Equal(expected, await validator.ValidateAsync(principal));
    }

    private sealed class TestEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "Ambulanzsystem.Tests";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private sealed class FailUserLookup : DbCommandInterceptor
    {
        public int? UserId { get; set; }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            if (UserId is int id && command.CommandText.Contains("FROM users")
                && command.Parameters.Cast<DbParameter>().Any(p => p.Value is int value && value == id))
                throw new InvalidOperationException("Simulated authorization database outage");
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

}
