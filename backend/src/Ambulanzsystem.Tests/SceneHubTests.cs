using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
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

    private async Task<(HttpClient Client, string Token)> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, token);
    }

    private HubConnection BuildHubConnection(string token) =>
        new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "/hubs/scene"), options =>
            {
                options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
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

        // eventA (own scope) succeeds; eventB (a different event entirely) must be rejected.
        await connection.InvokeAsync("JoinScene", eventA.id);

        await Assert.ThrowsAsync<HubException>(() => connection.InvokeAsync("JoinScene", eventB.id));
    }
}
