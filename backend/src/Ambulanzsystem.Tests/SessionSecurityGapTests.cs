using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Ambulanzsystem.Tests;

// Closes the "session and production-bootstrap" gaps: live QR revalidation, atomic QR
// self-cancel, forced-password-change gating, and subject-bound password changes.
public class SessionSecurityGapTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private sealed class FailOnRefreshRevocationInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (eventData.Context!.ChangeTracker.Entries<RefreshToken>()
                .Any(entry => entry.State == EntityState.Modified && entry.Entity.IsRevoked))
            {
                throw new InvalidOperationException("Injected refresh revocation failure.");
            }

            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }
    }
    private record TokenBearing(string? token);
    private record RefreshBearing(string? token, string? refreshToken);
    private record SceneBearing(int id);
    private record QrCode(int id, string qrToken);
    private record AdminLoginBody(string? token, bool requiresPasswordChange);
    private record DevLoginBody(string? token, string? username, bool requiresPasswordChange);

    // Login endpoints share one fixed-window rate limit bucket (NFR-SEC-05); cache the admin token
    // per WebApplicationFactory instance, same convention as SceneAccessRestTests, so this class's
    // several test methods don't each spend their own admin-login (+ possible forced-change
    // relogin) against that shared budget.
    private static readonly ConcurrentDictionary<WebApplicationFactory<Program>, Task<string>> AdminTokens = new();

    private Task<string> AdminTokenAsync() => AdminTokens.GetOrAdd(factory, f =>
        TestAuth.LoginAsync(f.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await AdminTokenAsync());
        return client;
    }

    private async Task<int> CreateSceneAsync(HttpClient admin)
    {
        var res = await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"session-gap-{Guid.NewGuid():N}" });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<SceneBearing>())!.id;
    }

    private async Task<(HttpClient Client, int QrLoginId)> QrSessionAsync(HttpClient admin, int sceneId)
    {
        var genRes = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = sceneId });
        genRes.EnsureSuccessStatusCode();
        var codes = await genRes.Content.ReadFromJsonAsync<QrCode[]>();

        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/qr-login", new { qr_code = codes![0].qrToken });
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, codes[0].id);
    }

    private static async Task<string> SetFirstDevAdminPasswordGateAsync(WebApplicationFactory<Program> appFactory, bool required)
    {
        await using var scope = appFactory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var admin = await db.Users
            .Where(u => u.Role == Ambulanzsystem.Api.Domain.Role.Admin && u.RevokedAt == null)
            .OrderBy(u => u.Id)
            .FirstAsync();
        admin.PasswordHash = BCrypt.Net.BCrypt.HashPassword("dev-admin-password");
        admin.RequiresPasswordChange = required;
        await db.SaveChangesAsync();
        return admin.Username;
    }

    [Fact]
    public async Task QrSession_RevokedServerSide_Is401OnNextRequest_NotOnlyAtNextTokenIssuance()
    {
        // The core live-revalidation property: revoking the underlying QrCodeLogin row must take
        // effect on the very next request against an already-issued, still-unexpired token — the
        // JWT's own claims must never be trusted as the source of truth for liveness.
        var admin = await AdminClientAsync();
        var scene = await CreateSceneAsync(admin);
        var (qr, qrLoginId) = await QrSessionAsync(admin, scene);

        var beforeRevoke = await qr.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.OK, beforeRevoke.StatusCode);

        var revoke = await admin.PostAsync($"/api/login-qr-codes/{qrLoginId}/revoke", null);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        var afterRevoke = await qr.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevoke.StatusCode);
    }

    [Fact]
    public async Task QrSelfCancel_SetsRevokedAt_AndWritesAuditEntry_AndBlocksFurtherRequests()
    {
        var admin = await AdminClientAsync();
        var scene = await CreateSceneAsync(admin);
        var (qr, qrLoginId) = await QrSessionAsync(admin, scene);

        var selfCancel = await qr.PostAsync("/api/users/self-cancel", null);
        Assert.Equal(HttpStatusCode.NoContent, selfCancel.StatusCode);

        var codes = await (await admin.GetAsync($"/api/login-qr-codes?eventSceneId={scene}"))
            .Content.ReadFromJsonAsync<JsonElement>();
        var matching = codes.EnumerateArray().First(c => c.GetProperty("id").GetInt32() == qrLoginId);
        Assert.False(matching.GetProperty("revokedAt").ValueKind is JsonValueKind.Null or JsonValueKind.Undefined);

        var audit = await (await admin.GetAsync("/api/audit?action=revoke")).Content.ReadFromJsonAsync<JsonElement>();
        var hasAuditEntry = audit.GetProperty("entries").EnumerateArray().Any(e =>
            e.GetProperty("entityType").GetString() == "qr_code_login" && e.GetProperty("entityId").GetInt32() == qrLoginId);
        Assert.True(hasAuditEntry);

        // Revocation is live-checked, so the same (now-cancelled) session must be rejected on its
        // very next request too, not just report success on the cancel call itself.
        var afterSelfCancel = await qr.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.Unauthorized, afterSelfCancel.StatusCode);
    }

    [Fact]
    public async Task NewlyCreatedAdmin_MustChangePassword_BeforeReachingNormalEndpoints_ButCanStillUseEscapeHatches()
    {
        var admin = await AdminClientAsync();
        var username = $"forced-change-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "originalPassword1", role = "admin" });
        create.EnsureSuccessStatusCode();

        var newAdmin = factory.CreateClient();
        var login = await newAdmin.PostAsJsonAsync("/api/admin-login", new { username, password = "originalPassword1" });
        login.EnsureSuccessStatusCode();
        var body = (await login.Content.ReadFromJsonAsync<AdminLoginBody>())!;
        Assert.True(body.requiresPasswordChange);
        newAdmin.DefaultRequestHeaders.Authorization = new("Bearer", body.token);

        // Blocked from a normal endpoint while the change is pending.
        var blocked = await newAdmin.GetAsync("/api/operation-scenes");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);

        // But the escape hatches must stay reachable.
        var validate = await newAdmin.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.OK, validate.StatusCode);

        var logout = await newAdmin.PostAsJsonAsync("/api/logout", new { refreshToken = Convert.ToBase64String(new byte[64]) });
        Assert.Equal(HttpStatusCode.BadRequest, logout.StatusCode);

        var changePassword = await newAdmin.PostAsJsonAsync("/api/users/change-password", new
        {
            username,
            password = "originalPassword1",
            newPassword = "newPassword2",
        });
        Assert.Equal(HttpStatusCode.NoContent, changePassword.StatusCode);

        // Once the change is complete, a fresh token can reach normal endpoints again.
        var relogin = await newAdmin.PostAsJsonAsync("/api/admin-login", new { username, password = "newPassword2" });
        relogin.EnsureSuccessStatusCode();
        var reloginBody = (await relogin.Content.ReadFromJsonAsync<AdminLoginBody>())!;
        Assert.False(reloginBody.requiresPasswordChange);
        newAdmin.DefaultRequestHeaders.Authorization = new("Bearer", reloginBody.token);

        var nowAllowed = await newAdmin.GetAsync("/api/operation-scenes");
        Assert.Equal(HttpStatusCode.OK, nowAllowed.StatusCode);
    }

    [Fact]
    public async Task NewlyCreatedResponder_IsNotForcedToChangePassword()
    {
        var admin = await AdminClientAsync();
        var username = $"responder-no-force-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "responder" });
        create.EnsureSuccessStatusCode();
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(body.GetProperty("requiresPasswordChange").GetBoolean());
    }

    [Fact]
    public async Task DevLogin_BypassesForcedChangeWithoutMintingRefreshToken_AndRealLoginStillRequiresIt()
    {
        await using var devLoginFactory = factory.WithWebHostBuilder(_ => { });
        await using var realLoginFactory = factory.WithWebHostBuilder(_ => { });
        var username = await SetFirstDevAdminPasswordGateAsync(devLoginFactory, true);
        try
        {
            var client = devLoginFactory.CreateClient();

            var devLogin = await client.PostAsJsonAsync("/api/dev-login", new { role = "admin" });
            devLogin.EnsureSuccessStatusCode();
            var devJson = await devLogin.Content.ReadFromJsonAsync<JsonElement>();
            var devBody = devJson.Deserialize<DevLoginBody>();
            Assert.Equal(username, devBody!.username);
            Assert.False(devBody.requiresPasswordChange);
            Assert.False(devJson.TryGetProperty("refreshToken", out _));

            client.DefaultRequestHeaders.Authorization = new("Bearer", devBody.token);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/operation-scenes")).StatusCode);

            var realLogin = await realLoginFactory.CreateClient().PostAsJsonAsync("/api/admin-login", new
            {
                username,
                password = "dev-admin-password",
            });
            realLogin.EnsureSuccessStatusCode();
            Assert.True((await realLogin.Content.ReadFromJsonAsync<AdminLoginBody>())!.requiresPasswordChange);
        }
        finally
        {
            await SetFirstDevAdminPasswordGateAsync(devLoginFactory, false);
        }
    }

    [Fact]
    public async Task DevLogin_RejectsUnknownRole()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/dev-login", new { role = "leitstelle" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_RejectsWhenSubmittedUsernameDoesNotMatchAuthenticatedUser()
    {
        var admin = await AdminClientAsync();

        var victimUsername = $"victim-{Guid.NewGuid():N}";
        var victimCreate = await admin.PostAsJsonAsync("/api/users", new { username = victimUsername, password = "victimPassword1", role = "responder" });
        victimCreate.EnsureSuccessStatusCode();

        var attackerUsername = $"attacker-{Guid.NewGuid():N}";
        var attackerCreate = await admin.PostAsJsonAsync("/api/users", new { username = attackerUsername, password = "attackerPassword1", role = "responder" });
        attackerCreate.EnsureSuccessStatusCode();

        var attacker = factory.CreateClient();
        var login = await attacker.PostAsJsonAsync("/api/user-login", new { username = attackerUsername, password = "attackerPassword1" });
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        attacker.DefaultRequestHeaders.Authorization = new("Bearer", token);

        // Attacker's own valid token + the victim's own correct password must still be rejected:
        // the change is bound to the authenticated principal's own subject id, not just a
        // username/password pair.
        var attempt = await attacker.PostAsJsonAsync("/api/users/change-password", new
        {
            username = victimUsername,
            password = "victimPassword1",
            newPassword = "irrelevantPassword1",
        });
        Assert.Equal(HttpStatusCode.Unauthorized, attempt.StatusCode);
    }

    [Fact]
    public async Task ChangePassword_RejectsBlankAndShortPasswords_ButAcceptsEightCharacters()
    {
        var admin = await AdminClientAsync();
        var username = $"short-pw-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "originalPassword1", role = "responder" });
        create.EnsureSuccessStatusCode();

        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/user-login", new { username, password = "originalPassword1" });
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);

        foreach (var newPassword in new[] { "", "       ", "1234567" })
        {
            var rejected = await client.PostAsJsonAsync("/api/users/change-password", new
            {
                username,
                password = "originalPassword1",
                newPassword,
            });
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        var accepted = await client.PostAsJsonAsync("/api/users/change-password", new
        {
            username,
            password = "originalPassword1",
            newPassword = "12345678",
        });
        Assert.Equal(HttpStatusCode.NoContent, accepted.StatusCode);
    }

    [Fact]
    public async Task ConcurrentPasswordChangeAndRefresh_NeverLeavesSuccessorRefreshTokenUsable()
    {
        var admin = await AdminClientAsync();

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var username = $"refresh-race-{Guid.NewGuid():N}";
            var oldPassword = "originalPassword1";
            var create = await admin.PostAsJsonAsync("/api/users", new
            {
                username,
                password = oldPassword,
                role = "responder",
            });
            create.EnsureSuccessStatusCode();

            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Forwarded-For", $"198.51.100.{attempt + 1}");
            var login = await client.PostAsJsonAsync("/api/user-login", new { username, password = oldPassword });
            login.EnsureSuccessStatusCode();
            var session = (await login.Content.ReadFromJsonAsync<RefreshBearing>())!;
            client.DefaultRequestHeaders.Authorization = new("Bearer", session.token);

            var refreshClient = factory.CreateClient();
            refreshClient.DefaultRequestHeaders.Add("X-Forwarded-For", $"198.51.100.{attempt + 1}");
            var changeTask = client.PostAsJsonAsync("/api/users/change-password", new
            {
                username,
                password = oldPassword,
                newPassword = "changedPassword2",
            });
            var rotateTask = refreshClient.PostAsJsonAsync("/api/refresh-token", new
            {
                refreshToken = session.refreshToken,
            });

            await Task.WhenAll(changeTask, rotateTask);
            Assert.Equal(HttpStatusCode.NoContent, changeTask.Result.StatusCode);
            Assert.Contains(rotateTask.Result.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });

            if (rotateTask.Result.StatusCode == HttpStatusCode.OK)
            {
                var successor = (await rotateTask.Result.Content.ReadFromJsonAsync<RefreshBearing>())!;
                var replay = await refreshClient.PostAsJsonAsync("/api/refresh-token", new
                {
                    refreshToken = successor.refreshToken,
                });
                Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
            }
        }
    }

    [Fact]
    public async Task ChangePassword_WhenRefreshRevocationFails_RollsBackEverySecurityMutationAndAudit()
    {
        string connectionString;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            connectionString = scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Database.GetConnectionString()!;
        }

        var username = $"atomic-password-{Guid.NewGuid():N}";
        var oldPassword = "originalPassword1";
        int userId;
        string originalStamp;
        await using (var arrange = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options))
        {
            var user = new User
            {
                Username = username,
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(oldPassword),
                Role = Role.Responder,
                RequiresPasswordChange = true,
            };
            arrange.Users.Add(user);
            await arrange.SaveChangesAsync();
            arrange.RefreshTokens.Add(new RefreshToken
            {
                UserId = user.Id,
                TokenHash = Convert.ToBase64String(Guid.NewGuid().ToByteArray()),
                ExpiresAt = DateTime.UtcNow.AddDays(1),
            });
            await arrange.SaveChangesAsync();
            userId = user.Id;
            originalStamp = user.SecurityStamp;
        }

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .AddInterceptors(new FailOnRefreshRevocationInterceptor())
            .Options;
        await using (var db = new AppDbContext(options))
        {
            var controller = new UsersController(
                db,
                new RefreshTokenService(db, Options.Create(new JwtOptions())),
                new AuditService(db))
            {
                ControllerContext = new ControllerContext
                {
                    HttpContext = new DefaultHttpContext
                    {
                        User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                        {
                            new Claim(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub, userId.ToString()),
                            new Claim(TokenTypes.ClaimType, TokenTypes.User),
                        }, "test")),
                    },
                },
            };

            await Assert.ThrowsAsync<InvalidOperationException>(() => controller.ChangePassword(
                new ChangePasswordRequest(username, oldPassword, "changedPassword2")));
        }

        await using var verify = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString).UseSnakeCaseNamingConvention().Options);
        var unchanged = await verify.Users.SingleAsync(user => user.Id == userId);
        Assert.True(BCrypt.Net.BCrypt.Verify(oldPassword, unchanged.PasswordHash));
        Assert.True(unchanged.RequiresPasswordChange);
        Assert.Equal(originalStamp, unchanged.SecurityStamp);
        Assert.False(await verify.RefreshTokens.Where(token => token.UserId == userId).AnyAsync(token => token.IsRevoked));
        Assert.False(await verify.AuditLogs.AnyAsync(entry =>
            entry.ActorId == userId && entry.EntityType == "user" && entry.AfterJson == "\"changed\""));
    }
}
