using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class OperationScenesTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id, bool active);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task UpdatingScene_WithoutActiveField_PreservesExistingActiveState()
    {
        // Regression test: Active used to be a plain non-nullable bool on the request DTO, so an
        // update that only touched e.g. description would silently reactivate a deactivated scene
        // (same bug class as the B2 missing-role default). Active is now nullable and
        // preserve-if-omitted.
        var client = await AdminClientAsync();
        var name = $"scene-{Guid.NewGuid():N}";

        var created = await client.PostAsJsonAsync("/api/operation-scenes", new { name });
        var scene = (await created.Content.ReadFromJsonAsync<SceneBearing>())!;
        Assert.True(scene.active);

        var deactivated = await client.PostAsJsonAsync("/api/operation-scenes", new { id = scene.id, name, active = false });
        Assert.False((await deactivated.Content.ReadFromJsonAsync<SceneBearing>())!.active);

        var metadataOnlyEdit = await client.PostAsJsonAsync("/api/operation-scenes", new { id = scene.id, name, description = "updated" });
        Assert.False((await metadataOnlyEdit.Content.ReadFromJsonAsync<SceneBearing>())!.active);
    }

    [Fact]
    public async Task SubSite_CannotBecomeParentOfAnotherSubSite()
    {
        var client = await AdminClientAsync();

        var eventScene = (await (await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"event-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var subSite = (await (await client.PostAsJsonAsync("/api/operation-scenes",
                new { name = $"sub-{Guid.NewGuid():N}", parentSceneId = eventScene.id }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var secondLevelAttempt = await client.PostAsJsonAsync("/api/operation-scenes",
            new { name = $"illegal-{Guid.NewGuid():N}", parentSceneId = subSite.id });

        Assert.Equal(HttpStatusCode.BadRequest, secondLevelAttempt.StatusCode);
    }
}
