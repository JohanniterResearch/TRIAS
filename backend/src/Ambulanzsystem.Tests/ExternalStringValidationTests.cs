using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Ambulanzsystem.Tests;

public class ExternalStringValidationTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private record TeamBearing(int id);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task NameWritePaths_Accept255Characters_AndReject256()
    {
        var client = await AdminClientAsync();
        var max = "x" + new string('a', 254);
        var over = max + "a";

        AssertSuccess(await client.PostAsJsonAsync("/api/organisations", new { name = max }));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/organisations", new { name = over })).StatusCode);

        var sceneResponse = await client.PostAsJsonAsync("/api/operation-scenes", new { name = max });
        AssertSuccess(sceneResponse);
        var sceneId = (await sceneResponse.Content.ReadFromJsonAsync<SceneBearing>())!.id;
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/operation-scenes", new { name = over })).StatusCode);

        AssertSuccess(await client.PostAsJsonAsync("/api/teams", new { operationSceneId = sceneId, name = max }));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/teams", new { operationSceneId = sceneId, name = over })).StatusCode);

        AssertSuccess(await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId, name = max }));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId, name = over })).StatusCode);
    }

    [Fact]
    public async Task FreeTextWritePaths_AcceptConfiguredBoundary_AndRejectOneOver()
    {
        var client = await AdminClientAsync();
        var sceneName = $"limits-{Guid.NewGuid():N}";
        var descriptionMax = new string('d', 2000);

        var sceneResponse = await client.PostAsJsonAsync("/api/operation-scenes",
            new { name = sceneName, description = descriptionMax });
        AssertSuccess(sceneResponse);
        var sceneId = (await sceneResponse.Content.ReadFromJsonAsync<SceneBearing>())!.id;
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/operation-scenes",
                new { name = sceneName, description = descriptionMax + "d" })).StatusCode);

        var patientResponse = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        AssertSuccess(patientResponse);
        var patientId = (await patientResponse.Content.ReadFromJsonAsync<PatientBearing>())!.id;

        var shortMax = new string('x', 255);
        AssertSuccess(await client.PostAsJsonAsync($"/api/persons/{patientId}/location",
            new { lat = 48.2, lng = 16.3, source = "manual", indoorLocation = shortMax }));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync($"/api/persons/{patientId}/location",
                new { lat = 48.2, lng = 16.3, source = "manual", indoorLocation = shortMax + "x" })).StatusCode);

        var teamResponse = await client.PostAsJsonAsync("/api/teams",
            new { operationSceneId = sceneId, name = $"team-{Guid.NewGuid():N}" });
        AssertSuccess(teamResponse);
        var teamId = (await teamResponse.Content.ReadFromJsonAsync<TeamBearing>())!.id;

        AssertSuccess(await client.PutAsJsonAsync($"/api/teams/{teamId}",
            new { assignedLocation = shortMax, contactInfo = shortMax }));
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync($"/api/teams/{teamId}",
                new { assignedLocation = shortMax + "x" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PutAsJsonAsync($"/api/teams/{teamId}",
                new { contactInfo = shortMax + "x" })).StatusCode);
    }

    private static void AssertSuccess(HttpResponseMessage response) =>
        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {response.Content.ReadAsStringAsync().GetAwaiter().GetResult()}");
}
