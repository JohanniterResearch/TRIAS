using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres (see backend/README / docker-compose.yml).
// Not hermetic (shared DB state across runs), but this stage's goal is a runnable regression
// check for the two real bugs manual testing caught, not a full B8-style suite.
public class AuthFlowTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private HttpClient Client() => factory.CreateClient();
    private static readonly ConcurrentDictionary<WebApplicationFactory<Program>, Task<string>> AdminTokens = new();

    private record TokenBearing(string? token, string? refreshToken);

    private Task<string> AdminLoginAsync(HttpClient client) =>
        AdminTokens.GetOrAdd(factory, _ =>
            TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password"));

    [Fact]
    public async Task CreateUser_WithoutRole_Returns400_NotAdmin()
    {
        // Regression test: CreateUserRequest.Role used to be non-nullable, so an omitted role
        // silently bound to Role.Admin (enum value 0) — a privilege-escalation bug caught by
        // manual B2 verification. Role must now be required and reject when absent.
        var client = Client();
        var adminToken = await AdminLoginAsync(client);
        client.DefaultRequestHeaders.Authorization = new("Bearer", adminToken);

        var res = await client.PostAsJsonAsync("/api/users", new
        {
            username = $"no-role-{Guid.NewGuid():N}",
            password = "somePassword1",
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task CreateUser_RejectsBlankAndShortPasswords_ButAcceptsEightCharacters()
    {
        var client = Client();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await AdminLoginAsync(client));

        foreach (var password in new[] { "", "       ", "1234567" })
        {
            var rejected = await client.PostAsJsonAsync("/api/users", new
            {
                username = $"password-policy-{Guid.NewGuid():N}",
                password,
                role = "responder",
            });
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        var accepted = await client.PostAsJsonAsync("/api/users", new
        {
            username = $"password-policy-{Guid.NewGuid():N}",
            password = "12345678",
            role = "responder",
        });
        Assert.Equal(HttpStatusCode.Created, accepted.StatusCode);
    }

    [Fact]
    public async Task PasswordChange_InvalidatesPriorAccessToken_Instantly()
    {
        var client = Client();
        var adminToken = await AdminLoginAsync(client);
        client.DefaultRequestHeaders.Authorization = new("Bearer", adminToken);

        var username = $"revoke-check-{Guid.NewGuid():N}";
        var create = await client.PostAsJsonAsync("/api/users", new
        {
            username,
            password = "originalPassword1",
            role = "responder",
        });
        create.EnsureSuccessStatusCode();

        var anon = Client();
        var login = await anon.PostAsJsonAsync("/api/user-login", new { username, password = "originalPassword1" });
        login.EnsureSuccessStatusCode();
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;

        anon.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var beforeChange = await anon.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.OK, beforeChange.StatusCode);

        var changePassword = await anon.PostAsJsonAsync("/api/users/change-password", new
        {
            username,
            password = "originalPassword1",
            newPassword = "changedPassword2",
        });
        Assert.Equal(HttpStatusCode.NoContent, changePassword.StatusCode);

        var afterChange = await anon.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.Unauthorized, afterChange.StatusCode);
    }

    [Fact]
    public async Task ResponderToken_CannotReachAdminOnlyEndpoint()
    {
        var admin = Client();
        var adminToken = await AdminLoginAsync(admin);
        admin.DefaultRequestHeaders.Authorization = new("Bearer", adminToken);

        var username = $"policy-check-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new
        {
            username,
            password = "responderPassword1",
            role = "responder",
        });
        create.EnsureSuccessStatusCode();

        var responder = Client();
        var login = await responder.PostAsJsonAsync("/api/user-login", new { username, password = "responderPassword1" });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        responder.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var res = await responder.PostAsJsonAsync("/api/users", new { username = "irrelevant", password = "x", role = "responder" });
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task ListUsers_IsAdminOnly_SortedDto_AndAuditedOnce()
    {
        var admin = Client();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await AdminLoginAsync(admin));

        var suffix = Guid.NewGuid().ToString("N");
        foreach (var username in new[] { $"z-{suffix}", $"a-{suffix}" })
        {
            (await admin.PostAsJsonAsync("/api/users", new
            {
                username,
                password = "somePassword1",
                role = "responder",
            })).EnsureSuccessStatusCode();
        }

        var auditBefore = await ReadAuditCountAsync(admin);
        var response = await admin.GetAsync("/api/users");
        response.EnsureSuccessStatusCode();
        var users = await response.Content.ReadFromJsonAsync<JsonElement>();
        var listed = users.EnumerateArray().ToArray();

        Assert.Equal(listed.OrderBy(user => user.GetProperty("username").GetString()).Select(user => user.GetProperty("username").GetString()),
            listed.Select(user => user.GetProperty("username").GetString()));
        Assert.All(listed, user =>
        {
            Assert.False(user.TryGetProperty("passwordHash", out _));
            Assert.True(user.TryGetProperty("requiresPasswordChange", out _));
        });
        Assert.Equal(auditBefore + 1, await ReadAuditCountAsync(admin));

        var responder = Client();
        var responderToken = await TestAuth.LoginAsync(responder, "/api/user-login", $"a-{suffix}", "somePassword1");
        responder.DefaultRequestHeaders.Authorization = new("Bearer", responderToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await responder.GetAsync("/api/users")).StatusCode);
    }

    [Fact]
    public async Task RefreshToken_ConcurrentReplay_AllowsOnlyOneSuccessor()
    {
        var admin = Client();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await AdminLoginAsync(admin));
        var username = $"refresh-race-{Guid.NewGuid():N}";
        (await admin.PostAsJsonAsync("/api/users", new
        {
            username,
            password = "somePassword1",
            role = "responder",
        })).EnsureSuccessStatusCode();

        var login = await Client().PostAsJsonAsync(
            "/api/user-login", new { username, password = "somePassword1" });
        login.EnsureSuccessStatusCode();
        var refreshToken = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.refreshToken!;

        var rotations = await Task.WhenAll(
            Client().PostAsJsonAsync("/api/refresh-token", new { refreshToken }),
            Client().PostAsJsonAsync("/api/refresh-token", new { refreshToken }));

        Assert.Equal(
            [HttpStatusCode.OK, HttpStatusCode.Unauthorized],
            rotations.Select(response => response.StatusCode).Order().ToArray());
    }

    [Fact]
    public async Task RefreshAndLogout_MalformedTokens_ReturnControlledResponses()
    {
        foreach (var refreshToken in new[] { "", "not-base64!", new string('A', 1024) })
        {
            var refresh = await Client().PostAsJsonAsync("/api/refresh-token", new { refreshToken });
            Assert.Contains(refresh.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized });
        }

        var admin = Client();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await AdminLoginAsync(admin));
        foreach (var refreshToken in new[] { "", "not-base64!", new string('A', 1024) })
        {
            var logout = await admin.PostAsJsonAsync("/api/logout", new { refreshToken });
            Assert.Contains(logout.StatusCode, new[] { HttpStatusCode.BadRequest, HttpStatusCode.Unauthorized });
        }
    }

    [Fact]
    public async Task RefreshToken_RepeatedAbuse_UsesDedicatedRateLimit()
    {
        await using var isolatedFactory = factory.WithWebHostBuilder(_ => { });
        var client = isolatedFactory.CreateClient();

        for (var request = 0; request < 10; request++)
        {
            var response = await client.PostAsJsonAsync("/api/refresh-token", new
            {
                refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray()),
            });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        var limited = await client.PostAsJsonAsync("/api/refresh-token", new
        {
            refreshToken = Convert.ToBase64String(Guid.NewGuid().ToByteArray()),
        });
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);

        // OpenAPI's RateLimited response promises the Error schema (status=error, message), not
        // the empty body ASP.NET's rate limiter middleware emits by default.
        var body = await limited.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("error", body.GetProperty("status").GetString());
        Assert.False(string.IsNullOrWhiteSpace(body.GetProperty("message").GetString()));
    }

    private static async Task<int> ReadAuditCountAsync(HttpClient client)
    {
        var response = await client.GetFromJsonAsync<JsonElement>("/api/audit?action=read&entityType=user");
        return response.GetProperty("total").GetInt32();
    }
}
