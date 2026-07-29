using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Closes the "session and production-bootstrap" gaps: live QR revalidation, atomic QR
// self-cancel, forced-password-change gating, and subject-bound password changes.
public class SessionSecurityGapTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record QrCode(int id, string qrToken);
    private record AdminLoginBody(string? token, bool requiresPasswordChange);

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
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

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
    public async Task ChangePassword_RejectsNewPasswordShorterThan8Characters()
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

        var attempt = await client.PostAsJsonAsync("/api/users/change-password", new
        {
            username,
            password = "originalPassword1",
            newPassword = "short1",
        });
        Assert.Equal(HttpStatusCode.BadRequest, attempt.StatusCode);
    }
}
