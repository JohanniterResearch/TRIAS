using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Ambulanzsystem.Tests;

// Task 2.1/2.2 (docs/remediationPlanContinued.md #2): the Team PUT endpoint reads a raw
// JsonElement body (FR-TEAM-07 needs absent-vs-null) and must reject malformed shapes/types and
// unknown properties with a controlled 400 — never a raw conversion exception, never a silent
// no-op accept — and must never mutate the row or write an audit entry when rejecting.
public class TeamRequestValidationTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id);
    private record TeamBearing(int id, string? status, int? assignedPatientId, string? assignedLocation, string? contactInfo);
    private record AuditQuery(int total);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<int> CreateSceneAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-{Guid.NewGuid():N}" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SceneBearing>())!.id;
    }

    private static async Task<int> CreateTeamAsync(HttpClient client, int sceneId)
    {
        var response = await client.PostAsJsonAsync("/api/teams",
            new { operationSceneId = sceneId, name = $"team-{Guid.NewGuid():N}" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TeamBearing>())!.id;
    }

    private static async Task<TeamBearing> GetTeamAsync(HttpClient client, int sceneId, int teamId)
    {
        var response = await client.GetAsync($"/api/teams?operationSceneId={sceneId}");
        response.EnsureSuccessStatusCode();
        var teams = await response.Content.ReadFromJsonAsync<List<TeamBearing>>();
        return teams!.Single(t => t.id == teamId);
    }

    private static async Task<int> AuditWriteCountAsync(HttpClient client, int teamId)
    {
        var response = await client.GetAsync($"/api/audit?entityType=team&entityId={teamId}&action=write");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuditQuery>())!.total;
    }

    private static StringContent RawJson(string json) => new(json, Encoding.UTF8, "application/json");

    // Shared assertion for every malformed-input case: controlled 400, row and audit trail both
    // untouched by the rejected request.
    private static async Task AssertRejectedWithoutSideEffectsAsync(
        HttpClient client, int sceneId, int teamId, StringContent body)
    {
        var before = await GetTeamAsync(client, sceneId, teamId);
        var auditBefore = await AuditWriteCountAsync(client, teamId);

        var response = await client.PutAsync($"/api/teams/{teamId}", body);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var after = await GetTeamAsync(client, sceneId, teamId);
        Assert.Equal(before, after);
        Assert.Equal(auditBefore, await AuditWriteCountAsync(client, teamId));
    }

    [Fact]
    public async Task Update_RejectsArrayRootBody()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("[]"));
    }

    [Fact]
    public async Task Update_RejectsScalarRootBody()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("\"just-a-string\""));
    }

    [Fact]
    public async Task Update_RejectsNumericStatus()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("""{"status": 1}"""));
    }

    [Fact]
    public async Task Update_RejectsBooleanAssignedLocation()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("""{"assignedLocation": true}"""));
    }

    [Fact]
    public async Task Update_RejectsStringAssignedPatientId()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("""{"assignedPatientId": "abc"}"""));
    }

    [Fact]
    public async Task Update_RejectsInvalidEnumStatus()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("""{"status": "nonexistent"}"""));
    }

    [Fact]
    public async Task Update_RejectsUnknownOnlyProperty()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        await AssertRejectedWithoutSideEffectsAsync(client, sceneId, teamId, RawJson("""{"contactInf": "typo"}"""));
    }

    [Fact]
    public async Task Update_AllowsNullClearingOfAllKnownFields()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        var response = await client.PutAsJsonAsync($"/api/teams/{teamId}",
            new { status = (string?)null, assignedPatientId = (int?)null, assignedLocation = (string?)null, contactInfo = (string?)null });

        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        var team = await GetTeamAsync(client, sceneId, teamId);
        Assert.Null(team.status);
        Assert.Null(team.assignedPatientId);
        Assert.Null(team.assignedLocation);
        Assert.Null(team.contactInfo);
    }

    [Fact]
    public async Task Update_AllowsValidPartialUpdate()
    {
        var client = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(client);
        var teamId = await CreateTeamAsync(client, sceneId);

        var response = await client.PutAsJsonAsync($"/api/teams/{teamId}", new { status = "busy" });

        Assert.True(response.IsSuccessStatusCode, $"Expected success, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        var team = await GetTeamAsync(client, sceneId, teamId);
        Assert.Equal("busy", team.status);
        Assert.Null(team.assignedLocation);
        Assert.Null(team.contactInfo);
    }
}
