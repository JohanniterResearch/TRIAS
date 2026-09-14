using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ambulanzsystem.Tests;

public class AdministrativeAuthorizationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id, string name, int? parentSceneId = null);
    private record UserBearing(int id);
    private record LoginQrCodeBearing(int id, string qrToken, int eventSceneId, DateTime? revokedAt);
    private record AdminState(int Id, DateTime? RevokedAt, string? RevokedBy);

    private static readonly ConcurrentDictionary<WebApplicationFactory<Program>, Task<string>> AdminTokens = new();

    private Task<string> AdminTokenAsync() => AdminTokens.GetOrAdd(factory, f =>
        TestAuth.LoginAsync(f.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await AdminTokenAsync());
        return client;
    }

    private async Task<SceneBearing> CreateSceneAsync(HttpClient admin, int? parentSceneId = null)
    {
        var response = await admin.PostAsJsonAsync("/api/operation-scenes", new
        {
            name = $"admin-auth-{Guid.NewGuid():N}",
            parentSceneId,
        });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SceneBearing>())!;
    }

    private async Task<(HttpClient Client, int Id)> CreateUserClientAsync(
        HttpClient admin,
        string role,
        string accountType = "permanent",
        int? eventSceneId = null)
    {
        var username = $"admin-auth-{role}-{Guid.NewGuid():N}";
        const string password = "somePassword1";
        var create = await admin.PostAsJsonAsync("/api/users", new
        {
            username,
            password,
            role,
            accountType,
            eventSceneId,
        });
        create.EnsureSuccessStatusCode();
        var id = (await create.Content.ReadFromJsonAsync<UserBearing>())!.id;

        string token;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var user = await db.Users.SingleAsync(u => u.Id == id);
            user.RequiresPasswordChange = false;
            await db.SaveChangesAsync();
            token = scope.ServiceProvider.GetRequiredService<TokenService>().IssueUserToken(user).Token;
        }

        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, id);
    }

    private static async Task<LoginQrCodeBearing[]> GenerateLoginQrCodesAsync(
        HttpClient client,
        int eventSceneId,
        int number = 1)
    {
        var response = await client.PostAsJsonAsync(
            "/api/login-qr-codes/generate",
            new { number, eventSceneId });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<LoginQrCodeBearing[]>())!;
    }

    [Fact]
    public async Task EventScope_MustBeExistingTopLevelEvent_AndGlobalActorsRemainGlobal()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin);
        var subSiteA = await CreateSceneAsync(admin, eventA.id);
        var eventB = await CreateSceneAsync(admin);
        var (scopedLeitstelle, _) = await CreateUserClientAsync(admin, "leitstelle", "event", eventA.id);
        var (globalLeitstelle, _) = await CreateUserClientAsync(admin, "leitstelle");

        Assert.Equal(HttpStatusCode.Created,
            (await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = eventA.id })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = subSiteA.id })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = int.MaxValue })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/users", new
            {
                username = $"invalid-scope-{Guid.NewGuid():N}",
                password = "somePassword1",
                role = "responder",
                accountType = "event",
                eventSceneId = subSiteA.id,
            })).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = eventB.id })).StatusCode);
        Assert.Equal(HttpStatusCode.Created,
            (await globalLeitstelle.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = eventB.id })).StatusCode);
    }

    [Fact]
    public async Task ScopedLeitstelle_LoginQrAdministration_IsForcedToOwnEvent_AndUnusedExcludesRevoked()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin);
        var eventB = await CreateSceneAsync(admin);
        var ownCode = (await GenerateLoginQrCodesAsync(admin, eventA.id))[0];
        var foreignCode = (await GenerateLoginQrCodesAsync(admin, eventB.id))[0];
        var (scopedLeitstelle, _) = await CreateUserClientAsync(admin, "leitstelle", "event", eventA.id);

        var unfiltered = await scopedLeitstelle.GetFromJsonAsync<LoginQrCodeBearing[]>("/api/login-qr-codes");
        Assert.NotEmpty(unfiltered!);
        Assert.All(unfiltered!, code => Assert.Equal(eventA.id, code.eventSceneId));
        Assert.DoesNotContain(unfiltered!, code => code.id == foreignCode.id || code.qrToken == foreignCode.qrToken);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.GetAsync($"/api/login-qr-codes?eventSceneId={eventB.id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/login-qr-codes/{foreignCode.id}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await scopedLeitstelle.PostAsync($"/api/login-qr-codes/{ownCode.id}/revoke", null)).StatusCode);

        var unused = await scopedLeitstelle.GetFromJsonAsync<LoginQrCodeBearing[]>(
            $"/api/login-qr-codes?eventSceneId={eventA.id}&unusedOnly=true");
        Assert.DoesNotContain(unused!, code => code.id == ownCode.id);
    }

    [Fact]
    public async Task ScopedLeitstelle_SceneMutations_CannotEscapeOrReparentAcrossOwnSubtree()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin);
        var subSiteA = await CreateSceneAsync(admin, eventA.id);
        var eventB = await CreateSceneAsync(admin);
        var (scopedLeitstelle, _) = await CreateUserClientAsync(admin, "leitstelle", "event", eventA.id);

        Assert.Equal(HttpStatusCode.OK,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new { id = eventA.id, name = "own-event-edited" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new
            {
                id = subSiteA.id,
                name = "own-subsite-edited",
                parentSceneId = eventA.id,
            })).StatusCode);
        Assert.Equal(HttpStatusCode.OK,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new
            {
                name = "own-subsite-created",
                parentSceneId = eventA.id,
            })).StatusCode);

        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new { id = eventB.id, name = "foreign-edit" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new { name = "foreign-child", parentSceneId = eventB.id })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new
            {
                id = subSiteA.id,
                name = "cross-scope-reparent",
                parentSceneId = eventB.id,
            })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsJsonAsync("/api/operation-scenes", new { name = "new-top-level" })).StatusCode);

        var scenes = await admin.GetFromJsonAsync<SceneBearing[]>("/api/operation-scenes");
        Assert.Equal(eventB.name, scenes!.Single(scene => scene.id == eventB.id).name);
        Assert.Equal(eventA.id, scenes!.Single(scene => scene.id == subSiteA.id).parentSceneId);
    }

    [Fact]
    public async Task UserRevocation_EnforcesTargetMatrix_SelfRoute_AndFinalAdminProtection()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin);
        var eventB = await CreateSceneAsync(admin);
        var (scopedLeitstelle, scopedLeitstelleId) = await CreateUserClientAsync(admin, "leitstelle", "event", eventA.id);
        var (globalLeitstelle, globalLeitstelleId) = await CreateUserClientAsync(admin, "leitstelle");
        var (ownResponder, ownResponderId) = await CreateUserClientAsync(admin, "responder", "event", eventA.id);
        var (foreignResponder, foreignResponderId) = await CreateUserClientAsync(admin, "responder", "event", eventB.id);
        var (_, globalResponderId) = await CreateUserClientAsync(admin, "responder");
        var (_, adminTargetId) = await CreateUserClientAsync(admin, "admin");

        Assert.Equal(HttpStatusCode.NoContent,
            (await scopedLeitstelle.PostAsync($"/api/users/{ownResponderId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await ownResponder.PostAsync("/api/validate-token", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/users/{foreignResponderId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/users/{globalResponderId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/users/{globalLeitstelleId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/users/{adminTargetId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scopedLeitstelle.PostAsync($"/api/users/{scopedLeitstelleId}/revoke", null)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent,
            (await globalLeitstelle.PostAsync($"/api/users/{foreignResponderId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await globalLeitstelle.PostAsync($"/api/users/{globalResponderId}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await globalLeitstelle.PostAsync($"/api/users/{adminTargetId}/revoke", null)).StatusCode);

        var (_, permanentAdminTargetId) = await CreateUserClientAsync(admin, "admin");
        Assert.Equal(HttpStatusCode.NoContent,
            (await admin.PostAsync($"/api/users/{permanentAdminTargetId}/revoke", null)).StatusCode);
        var (_, permanentResponderTargetId) = await CreateUserClientAsync(admin, "responder");
        Assert.Equal(HttpStatusCode.NoContent,
            (await admin.PostAsync($"/api/users/{permanentResponderTargetId}/revoke", null)).StatusCode);

        var (finalAdmin, finalAdminId) = await CreateUserClientAsync(admin, "admin");
        Assert.Equal(HttpStatusCode.Forbidden,
            (await finalAdmin.PostAsync($"/api/users/{finalAdminId}/revoke", null)).StatusCode);

        List<AdminState> adminStates;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            adminStates = await db.Users
                .Where(user => user.Role == Role.Admin)
                .Select(user => new AdminState(user.Id, user.RevokedAt, user.RevokedBy))
                .ToListAsync();
            await db.Users
                .Where(user => user.Role == Role.Admin && user.Id != finalAdminId && user.RevokedAt == null)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(user => user.RevokedAt, DateTime.UtcNow)
                    .SetProperty(user => user.RevokedBy, "test-final-admin"));
        }

        try
        {
            Assert.Equal(HttpStatusCode.Conflict,
                (await finalAdmin.PostAsync("/api/users/self-cancel", null)).StatusCode);
        }
        finally
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var state in adminStates)
            {
                var user = await db.Users.FindAsync(state.Id);
                if (user is null) continue;
                user.RevokedAt = state.RevokedAt;
                user.RevokedBy = state.RevokedBy;
            }
            await db.SaveChangesAsync();
        }
    }

    [Fact]
    public async Task ConcurrentAdminSelfCancellation_LeavesOneActiveAdmin()
    {
        var admin = await AdminClientAsync();
        var (adminA, adminAId) = await CreateUserClientAsync(admin, "admin");
        var (adminB, adminBId) = await CreateUserClientAsync(admin, "admin");

        List<AdminState> adminStates;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            adminStates = await db.Users
                .Where(user => user.Role == Role.Admin)
                .Select(user => new AdminState(user.Id, user.RevokedAt, user.RevokedBy))
                .ToListAsync();
            await db.Users
                .Where(user => user.Role == Role.Admin && user.Id != adminAId && user.Id != adminBId && user.RevokedAt == null)
                .ExecuteUpdateAsync(update => update
                    .SetProperty(user => user.RevokedAt, DateTime.UtcNow)
                    .SetProperty(user => user.RevokedBy, "test-concurrent-admins"));
        }

        try
        {
            var responses = await Task.WhenAll(
                adminA.PostAsync("/api/users/self-cancel", null),
                adminB.PostAsync("/api/users/self-cancel", null));

            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.NoContent);
            Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Conflict);

            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(1, await db.Users.CountAsync(user =>
                (user.Id == adminAId || user.Id == adminBId) && user.RevokedAt == null));
        }
        finally
        {
            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            foreach (var state in adminStates)
            {
                var user = await db.Users.FindAsync(state.Id);
                if (user is null) continue;
                user.RevokedAt = state.RevokedAt;
                user.RevokedBy = state.RevokedBy;
            }
            await db.SaveChangesAsync();
        }
    }
}
