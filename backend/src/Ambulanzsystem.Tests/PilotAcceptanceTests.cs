using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// S5 pilot-readiness pass: acceptance-list items that had no automated coverage —
// page-1 PUT/GET roundtrip (bind paths survive), per-patient record isolation,
// JSON export shape + watermark, and offline manual-creation idempotent replay.
public class PilotAcceptanceTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private async Task<int> CreateSceneAsync(HttpClient admin)
    {
        var res = await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-{Guid.NewGuid():N}" });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<SceneBearing>())!.id;
    }

    private async Task<int> CreatePatientAsync(HttpClient admin, int sceneId)
    {
        var res = await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PatientBearing>())!.id;
    }

    [Fact]
    public async Task Page1_PutGetRoundtrip_PreservesNestedJson_AndAllBindPaths()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin, await CreateSceneAsync(admin));

        var put = await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new
            {
                patient = new { familienname = "Roundtrip", vorname = "Test" },
                assessment_primary = new { naca = new[] { "IV" } },
            },
        });
        put.EnsureSuccessStatusCode();

        var get = await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1");
        get.EnsureSuccessStatusCode();
        var formState = (await get.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("formState");

        Assert.Equal("Roundtrip", formState.GetProperty("patient").GetProperty("familienname").GetString());
        Assert.Equal("IV", formState.GetProperty("assessment_primary").GetProperty("naca")[0].GetString());

        // Bind-path survival: every top-level branch of the default state must still exist
        // after a partial save — the frontend binds against all of them unconditionally.
        using var defaults = JsonDocument.Parse(
            await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Contract", "ambulanzprotokoll-page1-default.json")));
        foreach (var branch in defaults.RootElement.EnumerateObject())
        {
            Assert.True(formState.TryGetProperty(branch.Name, out _), $"missing default branch: {branch.Name}");
        }
    }

    [Fact]
    public async Task Page1_Records_AreIsolatedPerPatient()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patientA = await CreatePatientAsync(admin, sceneId);
        var patientB = await CreatePatientAsync(admin, sceneId);

        var put = await admin.PutAsJsonAsync($"/api/persons/{patientA}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "OnlyOnA" } },
        });
        put.EnsureSuccessStatusCode();

        var getB = await admin.GetAsync($"/api/persons/{patientB}/ambulanzprotokoll-page1");
        var formStateB = (await getB.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("formState");
        Assert.Equal("", formStateB.GetProperty("patient").GetProperty("familienname").GetString());
    }

    [Fact]
    public async Task Export_ReturnsDefaultShapedFormState_WithActorWatermark()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin, await CreateSceneAsync(admin));

        var res = await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1/export");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var watermark = body.GetProperty("metadata").GetProperty("watermark").GetString()!;
        Assert.Contains("admin", watermark);

        var formState = body.GetProperty("protokoll").GetProperty("formState");
        Assert.True(formState.TryGetProperty("incident", out _));
        Assert.True(formState.TryGetProperty("patient", out _));
    }

    [Fact]
    public async Task ManualPatient_SameClientGeneratedId_ReplaysToSamePatient()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var clientGeneratedId = Guid.NewGuid();

        var first = await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId, clientGeneratedId });
        first.EnsureSuccessStatusCode();
        var firstId = (await first.Content.ReadFromJsonAsync<PatientBearing>())!.id;

        var replay = await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId, clientGeneratedId });
        replay.EnsureSuccessStatusCode();
        var replayId = (await replay.Content.ReadFromJsonAsync<PatientBearing>())!.id;

        Assert.Equal(firstId, replayId);
    }

    [Fact]
    public async Task ManualPatient_ConcurrentReplayOfSameClientGeneratedId_ResultsInExactlyOnePatient()
    {
        // D3/offline-replay concurrency: two devices racing to create the same offline-generated
        // patient must never end up as two rows — the unique ClientGeneratedId index is the
        // concurrency authority, and the loser's insert must fall back to the winner's row.
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var clientGeneratedId = Guid.NewGuid();
        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;

        var tasks = Enumerable.Range(0, 8).Select(async _ =>
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var res = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId, clientGeneratedId });
            res.EnsureSuccessStatusCode();
            return (await res.Content.ReadFromJsonAsync<PatientBearing>())!.id;
        });

        var ids = await Task.WhenAll(tasks);

        Assert.Single(ids.Distinct());

        var list = await admin.GetAsync($"/api/persons?operationSceneId={sceneId}");
        list.EnsureSuccessStatusCode();
        var patients = await list.Content.ReadFromJsonAsync<JsonElement[]>();
        var matching = patients!.Count(p => p.TryGetProperty("clientGeneratedId", out var cg)
            && cg.ValueKind != JsonValueKind.Null && cg.GetGuid() == clientGeneratedId);
        Assert.Equal(1, matching);
    }

    [Fact]
    public async Task ManualPatient_CreatesBodyRow_AsPartOfTransactionalFlow()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin, await CreateSceneAsync(admin));

        var body = await admin.GetAsync($"/api/body-parts?idpatient={patientId}");

        Assert.Equal(HttpStatusCode.OK, body.StatusCode);
    }
}
