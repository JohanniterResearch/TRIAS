using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class AuditTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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

    [Fact]
    public async Task ReadingAPatientBearingEndpoint_ProducesExactlyOneReadAuditEntry()
    {
        // Regression guard for AuditReadFilter: a GET on a [AuditRead]-decorated action must log
        // one row per request (D7 / NFR-SEC-08), not zero (the attribute silently stops being
        // picked up) and not many (per-row spam the flow doc explicitly rules out).
        var client = await AdminClientAsync();

        var scene = (await (await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"audit-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;

        var before = await CountReadEntriesAsync(client, patient.id);

        var get = await client.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1");
        get.EnsureSuccessStatusCode();

        var after = await CountReadEntriesAsync(client, patient.id);

        Assert.Equal(before + 1, after);
    }

    private static async Task<int> CountReadEntriesAsync(HttpClient client, int patientId)
    {
        var res = await client.GetAsync($"/api/audit?patientId={patientId}&action=read");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("total").GetInt32();
    }
}
