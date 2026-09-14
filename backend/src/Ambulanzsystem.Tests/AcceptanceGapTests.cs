using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Closes the remaining gaps from the B8 acceptance checklist not covered by the other test
// files: bare unauthorized access, triage color validation, revocation of a specific user via
// the admin endpoint, and the Ambulanzprotokoll page-1 default-state GET.
public class AcceptanceGapTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
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
    public async Task ProtectedEndpoint_WithoutToken_Returns401()
    {
        var client = factory.CreateClient();
        var res = await client.GetAsync("/api/persons?operationSceneId=1");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task UpdateTriageColor_RejectsInvalidColor_AcceptsUmlautVariant()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patientId = await CreatePatientAsync(admin, sceneId);

        var invalid = await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "blau" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var valid = await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "grün" });
        valid.EnsureSuccessStatusCode();
        var body = await valid.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal("gruen", body.GetProperty("triagefarbe").GetString());
    }

    [Fact]
    public async Task RevokedUser_LosesAccessImmediately()
    {
        var admin = await AdminClientAsync();
        var username = $"revoke-endpoint-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "revokeMe1", role = "responder" });
        create.EnsureSuccessStatusCode();
        var userId = (await create.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetInt32();

        var responder = factory.CreateClient();
        var login = await responder.PostAsJsonAsync("/api/user-login", new { username, password = "revokeMe1" });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        responder.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var beforeRevoke = await responder.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.OK, beforeRevoke.StatusCode);

        var revoke = await admin.PostAsync($"/api/users/{userId}/revoke", null);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        var afterRevoke = await responder.PostAsync("/api/validate-token", null);
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevoke.StatusCode);
    }

    [Fact]
    public async Task AmbulanzprotokollGet_ForFreshPatient_ReturnsDraftWithDefaultShape()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patientId = await CreatePatientAsync(admin, sceneId);

        var res = await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();

        Assert.Equal("draft", body.GetProperty("status").GetString());
        Assert.Equal(System.Text.Json.JsonValueKind.Object, body.GetProperty("formState").ValueKind);
    }
}
