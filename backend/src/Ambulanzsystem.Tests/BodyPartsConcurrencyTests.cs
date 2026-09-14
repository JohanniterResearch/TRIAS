using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Ambulanzsystem.Tests;

public class BodyPartsConcurrencyTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id);
    private record PatientBearing(int id);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task ConcurrentDistinctToggles_PreserveBothMarks()
    {
        var admin = await AdminClientAsync();
        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"body-{Guid.NewGuid():N}" }))
                .Content.ReadFromJsonAsync<SceneBearing>())!;
            var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
                .Content.ReadFromJsonAsync<PatientBearing>())!;

            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var requests = new[]
            {
                ToggleAsync(token, patient.id, "kopf_vorne", true, start.Task),
                ToggleAsync(token, patient.id, "brust_links_vorne", true, start.Task),
            };
            start.SetResult();
            var responses = await Task.WhenAll(requests);
            Assert.All(responses, response => response.EnsureSuccessStatusCode());

            var state = await (await admin.GetAsync($"/api/body-parts?idpatient={patient.id}"))
                .Content.ReadFromJsonAsync<JsonElement>();
            var parts = state.GetProperty("bodyParts");
            Assert.Equal(1, parts.GetProperty("kopf_vorne").GetInt32());
            Assert.Equal(1, parts.GetProperty("brust_links_vorne").GetInt32());

            (await ToggleAsync(token, patient.id, "kopf_vorne", true)).EnsureSuccessStatusCode();
            state = await (await admin.GetAsync($"/api/body-parts?idpatient={patient.id}"))
                .Content.ReadFromJsonAsync<JsonElement>();
            Assert.Equal(1, state.GetProperty("bodyParts").GetProperty("kopf_vorne").GetInt32());
        }
    }

    [Fact]
    public async Task UnknownRegion_ReturnsBadRequest()
    {
        var admin = await AdminClientAsync();
        var response = await admin.PutAsJsonAsync("/api/body-parts",
            new { idpatient = int.MaxValue, bodyPartId = "not-a-region", isClicked = true });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private async Task<HttpResponseMessage> ToggleAsync(string? token, int patientId, string part, bool clicked, Task? start = null)
    {
        if (start is not null) await start;
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return await client.PutAsJsonAsync("/api/body-parts",
            new { idpatient = patientId, bodyPartId = part, isClicked = clicked });
    }
}
