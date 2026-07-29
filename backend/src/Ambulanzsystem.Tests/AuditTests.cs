using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class AuditTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private record OrgBearing(int id);
    private record TeamBearing(int id);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private async Task<int> CreateSceneAsync(HttpClient client)
    {
        var scene = (await (await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"audit-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        return scene.id;
    }

    [Fact]
    public async Task ReadingAPatientBearingEndpoint_ProducesExactlyOneReadAuditEntry()
    {
        // Regression guard for AuditReadFilter: a GET on a [AuditRead]-decorated action must log
        // one row per request (D7 / NFR-SEC-08), not zero (the attribute silently stops being
        // picked up) and not many (per-row spam the flow doc explicitly rules out).
        var client = await AdminClientAsync();

        var sceneId = await CreateSceneAsync(client);
        var patient = (await (await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;

        var before = await CountAsync(client, $"patientId={patient.id}&action=read");

        var get = await client.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1");
        get.EnsureSuccessStatusCode();

        var after = await CountAsync(client, $"patientId={patient.id}&action=read");

        Assert.Equal(before + 1, after);
    }

    [Fact]
    public async Task Export_ProducesAnExportAuditEntry_NotAGenericWrite()
    {
        // D7 requirement 1: export is a real, filterable audit action (action=export), distinct
        // from the "write" that persists the AmbulanzprotokollExport archive row.
        var client = await AdminClientAsync();

        var sceneId = await CreateSceneAsync(client);
        var patient = (await (await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;

        var before = await CountAsync(client, $"patientId={patient.id}&action=export");

        var export = await client.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1/export");
        export.EnsureSuccessStatusCode();

        var after = await CountAsync(client, $"patientId={patient.id}&action=export");
        Assert.Equal(before + 1, after);

        var entries = await QueryAsync(client, $"patientId={patient.id}&action=export");
        var entry = entries.EnumerateArray().First();
        Assert.Equal("ambulanzprotokoll_export", entry.GetProperty("entityType").GetString());
    }

    [Fact]
    public async Task ProtocolUpsert_WithNestedVitalsChange_RecordsLeafPathBeforeAndAfter()
    {
        // D7 requirement 3: a nested formState change must be recorded as its own leaf path
        // (e.g. "vitals.puls") with real before/after values, not folded into a generic status
        // field.
        var client = await AdminClientAsync();

        var sceneId = await CreateSceneAsync(client);
        var patient = (await (await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;

        var first = await client.PutAsJsonAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { vitals = new { puls = "80" } },
        });
        first.EnsureSuccessStatusCode();

        var second = await client.PutAsJsonAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { vitals = new { puls = "92" } },
        });
        second.EnsureSuccessStatusCode();

        var entries = await QueryAsync(client, $"patientId={patient.id}&action=write&entityType=ambulanzprotokoll");
        var latest = entries.EnumerateArray().First(); // most recent first (OrderByDescending)

        var changedFields = latest.GetProperty("changedFields").EnumerateArray().Select(f => f.GetString()).ToList();
        Assert.Contains("vitals.puls", changedFields);

        var before = JsonDocument.Parse(latest.GetProperty("before").GetString()!).RootElement;
        var after = JsonDocument.Parse(latest.GetProperty("after").GetString()!).RootElement;
        Assert.Equal("80", before.GetProperty("vitals.puls").GetString());
        Assert.Equal("92", after.GetProperty("vitals.puls").GetString());
    }

    [Fact]
    public async Task OrganisationCreate_AndList_ProduceWriteAndReadAuditEntries()
    {
        // Representative admin write + read (D7 requirement 2): every authenticated controller
        // action, not just patient-facing ones, must be audited.
        var client = await AdminClientAsync();

        var beforeWrite = await CountAsync(client, "action=write&entityType=organisation");
        var beforeRead = await CountAsync(client, "action=read&entityType=organisation_list");

        var create = await client.PostAsJsonAsync("/api/organisations", new { name = $"org-{Guid.NewGuid():N}" });
        create.EnsureSuccessStatusCode();

        var list = await client.GetAsync("/api/organisations");
        list.EnsureSuccessStatusCode();

        Assert.Equal(beforeWrite + 1, await CountAsync(client, "action=write&entityType=organisation"));
        Assert.Equal(beforeRead + 1, await CountAsync(client, "action=read&entityType=organisation_list"));
    }

    [Fact]
    public async Task TeamCreate_AndList_ProduceWriteAndReadAuditEntries()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);

        var beforeWrite = await CountAsync(client, "action=write&entityType=team");
        var beforeRead = await CountAsync(client, "action=read&entityType=team_list");

        var create = await client.PostAsJsonAsync("/api/teams", new { operationSceneId = sceneId, name = $"team-{Guid.NewGuid():N}" });
        create.EnsureSuccessStatusCode();

        var list = await client.GetAsync($"/api/teams?operationSceneId={sceneId}");
        list.EnsureSuccessStatusCode();

        Assert.Equal(beforeWrite + 1, await CountAsync(client, "action=write&entityType=team"));
        Assert.Equal(beforeRead + 1, await CountAsync(client, "action=read&entityType=team_list"));
    }

    [Fact]
    public void AuditController_ExposesOnlyReadEndpoints_NoUpdateOrDeletePath()
    {
        // D7 requirement 5: audit rows are append-only. There is no HTTP path capable of
        // mutating or removing an existing AuditLog row — the controller only exposes GET, and
        // AppDbContext never calls Update/Remove on the AuditLogs set anywhere in the app.
        var methods = typeof(AuditController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly);
        foreach (var method in methods)
        {
            var hasMutatingVerb = method.GetCustomAttributes()
                .Any(a => a is HttpPutAttribute or HttpPostAttribute or HttpDeleteAttribute or HttpPatchAttribute);
            Assert.False(hasMutatingVerb, $"{method.Name} exposes a mutating HTTP verb on the append-only audit log.");
        }
    }

    private static async Task<int> CountAsync(HttpClient client, string queryString)
    {
        var res = await client.GetAsync($"/api/audit?{queryString}");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("total").GetInt32();
    }

    private static async Task<JsonElement> QueryAsync(HttpClient client, string queryString)
    {
        var res = await client.GetAsync($"/api/audit?{queryString}");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("entries");
    }
}
