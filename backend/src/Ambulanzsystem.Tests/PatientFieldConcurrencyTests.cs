using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ambulanzsystem.Tests;

public class PatientFieldConcurrencyTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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

    private async Task<(int patientId, int sceneId)> CreatePatientAsync(HttpClient admin)
    {
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"patient-fields-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;
        return (patient.id, scene.id);
    }

    [Fact]
    public async Task ConcurrentFieldEndpoints_PreserveAllScalarsAndLedgerEntries_AndRejectOlderReplay()
    {
        var admin = await AdminClientAsync();
        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var (patientId, _) = await CreatePatientAsync(admin);
            var timestamp = DateTime.UtcNow.AddMinutes(-1);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var requests = new[]
            {
                PostAsync(token, $"/api/persons/{patientId}/update-triage-color",
                    new { triageColor = "rot", blutung = true, clientUpdatedAt = timestamp }, start.Task),
                PostAsync(token, $"/api/persons/{patientId}/respiration",
                    new { respiration = true, clientUpdatedAt = timestamp }, start.Task),
                PostAsync(token, $"/api/persons/{patientId}/location",
                    new { lat = 48.2, lng = 16.3, source = "gps", clientUpdatedAt = timestamp }, start.Task),
            };
            start.SetResult();
            var responses = await Task.WhenAll(requests);
            Assert.All(responses, response => response.EnsureSuccessStatusCode());

            var older = await admin.PostAsJsonAsync($"/api/persons/{patientId}/respiration",
                new { respiration = false, clientUpdatedAt = timestamp.AddMinutes(-1) });
            older.EnsureSuccessStatusCode();

            await using var scope = factory.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var patient = await db.Patients.AsNoTracking().SingleAsync(p => p.Id == patientId);
            var ledger = JsonSerializer.Deserialize<Dictionary<string, DateTime>>(patient.FieldTimestampsJson)!;

            Assert.True(patient.Atmung);
            Assert.True(patient.Blutung);
            Assert.Equal("rot", patient.Triagefarbe);
            Assert.Equal(48.2, patient.LatitudePatient);
            Assert.Equal(16.3, patient.LongitudePatient);
            Assert.Contains("atmung", ledger.Keys);
            Assert.Contains("blutung", ledger.Keys);
            Assert.Contains("triagefarbe", ledger.Keys);
            Assert.Contains("location", ledger.Keys);
        }
    }

    [Fact]
    public async Task FieldUpdates_RemainForbiddenOutsideSceneScope()
    {
        var admin = await AdminClientAsync();
        var (_, sceneA) = await CreatePatientAsync(admin);
        var (patientB, _) = await CreatePatientAsync(admin);
        var generate = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = sceneA });
        var qr = (await generate.Content.ReadFromJsonAsync<JsonElement[]>())![0].GetProperty("qrToken").GetString();
        var scoped = factory.CreateClient();
        var login = await scoped.PostAsJsonAsync("/api/qr-login", new { qr_code = qr });
        scoped.DefaultRequestHeaders.Authorization = new("Bearer",
            (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString());

        Assert.Equal(HttpStatusCode.Forbidden,
            (await scoped.PostAsJsonAsync($"/api/persons/{patientB}/update-triage-color", new { blutung = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scoped.PostAsJsonAsync($"/api/persons/{patientB}/respiration", new { respiration = true })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await scoped.PostAsJsonAsync($"/api/persons/{patientB}/location", new { lat = 48.2, lng = 16.3, source = "gps" })).StatusCode);
    }

    private async Task<HttpResponseMessage> PostAsync(string? token, string path, object request, Task? start = null)
    {
        if (start is not null) await start;
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return await client.PostAsJsonAsync(path, request);
    }
}
