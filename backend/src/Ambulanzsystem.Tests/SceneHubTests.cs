using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests. Uses the
// TestServer's own HttpMessageHandler so the SignalR connection stays in-process — no separately
// running server needed.
public class SceneHubTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token, int? eventSceneId);
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private record QrCode(string qrToken);

    private async Task<(HttpClient Client, string Token)> AdminClientAsync(WebApplicationFactory<Program>? appFactory = null)
    {
        var client = (appFactory ?? factory).CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, token);
    }

    private HubConnection BuildHubConnection(string token, WebApplicationFactory<Program>? appFactory = null) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri((appFactory ?? factory).Server.BaseAddress, "/hubs/scene"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.WebSocketFactory = async (context, cancellationToken) =>
                {
                    var client = (appFactory ?? factory).Server.CreateWebSocketClient();
                    client.ConfigureRequest = request => request.Headers.Authorization = $"Bearer {token}";
                    return await client.ConnectAsync(context.Uri, cancellationToken);
                };
                options.HttpMessageHandlerFactory = _ => (appFactory ?? factory).Server.CreateHandler();
                options.AccessTokenProvider = () => Task.FromResult<string?>(token);
            })
            .Build();

    [Fact]
    public async Task JoinScene_ReturnsSnapshot_ThenReceivesLiveUpdateAfterTriageWrite()
    {
        var (admin, adminToken) = await AdminClientAsync();

        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"hub-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;

        await using var connection = BuildHubConnection(adminToken);

        var snapshotTcs = new TaskCompletionSource<System.Text.Json.JsonElement>();
        connection.On<System.Text.Json.JsonElement>("SceneSnapshot", msg => snapshotTcs.TrySetResult(msg));

        var updateTcs = new TaskCompletionSource<System.Text.Json.JsonElement>();
        connection.On<System.Text.Json.JsonElement>("PatientUpdated", msg => updateTcs.TrySetResult(msg));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinScene", scene.id);

        var snapshot = await snapshotTcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(scene.id, snapshot.GetProperty("sceneId").GetInt32());
        Assert.Single(snapshot.GetProperty("patients").EnumerateArray());

        // Trigger a triage write from a completely separate client — the hub connection above
        // must receive a live PatientUpdated broadcast without polling.
        var triageWrite = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/update-triage-color", new { triageColor = "rot" });
        triageWrite.EnsureSuccessStatusCode();

        var update = await updateTcs.Task.WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal(patient.id, update.GetProperty("patient").GetProperty("id").GetInt32());
        Assert.Equal("rot", update.GetProperty("patient").GetProperty("triagefarbe").GetString());
    }

    [Fact]
    public async Task JoinScene_OutsideEventSubtree_IsRejectedForQrSession()
    {
        var (admin, _) = await AdminClientAsync();

        var eventA = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"event-a-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var eventB = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"event-b-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var genRes = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = eventA.id });
        var codes = await genRes.Content.ReadFromJsonAsync<QrCode[]>();

        var qrClient = factory.CreateClient();
        var qrLogin = await qrClient.PostAsJsonAsync("/api/qr-login", new { qr_code = codes![0].qrToken });
        var qrToken = (await qrLogin.Content.ReadFromJsonAsync<TokenBearing>())!.token!;

        await using var connection = BuildHubConnection(qrToken);
        await connection.StartAsync();

        var ownAuditBefore = await SnapshotAuditCountAsync(admin, eventA.id);
        var deniedAuditBefore = await SnapshotAuditCountAsync(admin, eventB.id);

        // eventA (own scope) succeeds; eventB (a different event entirely) must be rejected.
        await connection.InvokeAsync("JoinScene", eventA.id);
        await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("JoinScene", eventB.id));

        Assert.Equal(ownAuditBefore + 1, await SnapshotAuditCountAsync(admin, eventA.id));
        Assert.Equal(deniedAuditBefore, await SnapshotAuditCountAsync(admin, eventB.id));
    }

    [Fact]
    public async Task RedactionFlag_AppliesIdenticallyToSnapshotAndPatientUpdated()
    {
        using var redactingFactory = factory.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Features:RedactPersonalData"] = "true",
            })));
        var (admin, token) = await AdminClientAsync(redactingFactory);
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"redact-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual",
                new { operationSceneId = scene.id, name = "Sensitive Name" }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;
        (await admin.PostAsJsonAsync($"/api/persons/{patient.id}/location", new
        {
            lat = 48.2082,
            lng = 16.3738,
            source = "manual",
            accuracyMeters = 3.5,
            indoorLocation = "Treatment tent 4",
        })).EnsureSuccessStatusCode();

        await using var connection = BuildHubConnection(token, redactingFactory);
        var snapshotTcs = new TaskCompletionSource<JsonElement>();
        connection.On<JsonElement>("SceneSnapshot", message => snapshotTcs.TrySetResult(message));
        var updateTcs = new TaskCompletionSource<JsonElement>();
        connection.On<JsonElement>("PatientUpdated", message => updateTcs.TrySetResult(message));

        await connection.StartAsync();
        await connection.InvokeAsync("JoinScene", scene.id);
        var snapshotPatient = (await snapshotTcs.Task.WaitAsync(TimeSpan.FromSeconds(10)))
            .GetProperty("patients").EnumerateArray().Single();

        (await admin.PostAsJsonAsync($"/api/persons/{patient.id}/update-triage-color",
            new { triageColor = "rot" })).EnsureSuccessStatusCode();
        var updatedPatient = (await updateTcs.Task.WaitAsync(TimeSpan.FromSeconds(10))).GetProperty("patient");

        AssertRedacted(snapshotPatient);
        AssertRedacted(updatedPatient);
        Assert.Equal(patient.id, snapshotPatient.GetProperty("id").GetInt32());
        Assert.Equal(patient.id, updatedPatient.GetProperty("id").GetInt32());
        Assert.Equal(scene.id, updatedPatient.GetProperty("operationSceneId").GetInt32());
        Assert.Equal("rot", updatedPatient.GetProperty("triagefarbe").GetString());
    }

    private static void AssertRedacted(JsonElement patient)
    {
        foreach (var field in new[]
                 {
                     "name", "longitudePatient", "latitudePatient", "locationSource",
                     "locationAccuracyMeters", "indoorLocation", "locationUpdatedAt",
                 })
        {
            Assert.Equal(JsonValueKind.Null, patient.GetProperty(field).ValueKind);
        }
    }

    private static async Task<int> SnapshotAuditCountAsync(HttpClient admin, int sceneId)
    {
        var response = await admin.GetAsync("/api/audit?action=read&entityType=scene_snapshot&pageSize=500");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("entries").EnumerateArray().Count(entry =>
            entry.GetProperty("entityId").ValueKind != JsonValueKind.Null &&
            entry.GetProperty("entityId").GetInt32() == sceneId);
    }
}
