using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ambulanzsystem.Tests;

public class ApiTrustBoundaryTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private record UserBearing(int id);
    private record TokenBearing(string? token);
    private record QrCode(string qrToken);

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

    private async Task<(HttpClient Client, int UserId)> ResponderClientAsync(HttpClient admin, string username)
    {
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "responder" });
        create.EnsureSuccessStatusCode();
        var userId = (await create.Content.ReadFromJsonAsync<UserBearing>())!.id;

        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/user-login", username, "somePassword1");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, userId);
    }

    private async Task<HttpClient> LeitstelleClientAsync(HttpClient admin)
    {
        var username = $"leitstelle-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "leitstelle" });
        create.EnsureSuccessStatusCode();

        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", username, "somePassword1");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<int> ExportAuditCountAsync(HttpClient admin, int patientId)
    {
        var res = await admin.GetAsync($"/api/audit?patientId={patientId}&action=export");
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("total").GetInt32();
    }

    private async Task<int> ExportArchiveCountAsync(int patientId)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.AmbulanzprotokollExports.CountAsync(e => e.PatientId == patientId);
    }

    [Fact]
    public async Task TriageUpdate_RejectsUnknownField_MalformedBoolean_AndFutureTimestamp()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patient = await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>();

        var unknown = await admin.PostAsJsonAsync($"/api/persons/{patient!.id}/update-triage-color",
            new { triageColor = "rot", extra = true });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);

        var malformed = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/update-triage-color",
            new { respiration = "yes" });
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);

        var future = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/update-triage-color",
            new { triageColor = "rot", clientUpdatedAt = DateTime.UtcNow.AddMinutes(6) });
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);

        var respirationFuture = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/respiration",
            new { respiration = true, clientUpdatedAt = DateTime.UtcNow.AddMinutes(6) });
        Assert.Equal(HttpStatusCode.BadRequest, respirationFuture.StatusCode);
    }

    [Fact]
    public async Task LocationUpdate_RejectsOutOfRangeCoordinates_InvalidSource_AndNegativeAccuracy()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patient = await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>();

        var badLat = await admin.PostAsJsonAsync($"/api/persons/{patient!.id}/location",
            new { lat = 91, lng = 16.3 });
        Assert.Equal(HttpStatusCode.BadRequest, badLat.StatusCode);

        var badSource = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/location",
            new { lat = 48.2, lng = 16.3, source = "cell" });
        Assert.Equal(HttpStatusCode.BadRequest, badSource.StatusCode);

        var badAccuracy = await admin.PostAsJsonAsync($"/api/persons/{patient.id}/location",
            new { lat = 48.2, lng = 16.3, accuracyMeters = -1 });
        Assert.Equal(HttpStatusCode.BadRequest, badAccuracy.StatusCode);
    }

    [Fact]
    public async Task ProtocolUpsert_RejectsUnknownSchemaProperty_AndExportCarriesCanonicalSchemaReference()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var patient = await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>();

        var invalid = await admin.PutAsJsonAsync($"/api/persons/{patient!.id}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "Valid", unknown = "nope" } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var missingFormState = await admin.PutAsJsonAsync(
            $"/api/persons/{patient.id}/ambulanzprotokoll-page1", new { status = "draft" });
        Assert.Equal(HttpStatusCode.BadRequest, missingFormState.StatusCode);

        var export = await admin.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1/export");
        export.EnsureSuccessStatusCode();
        var body = await export.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            AmbulanzprotokollSchemaValidator.CanonicalSchemaReference,
            body.GetProperty("metadata").GetProperty("schemaVersion").GetString());
    }

    [Fact]
    public async Task ProtocolExport_AllowsOwnerResponderAndLeitstelle_ButRejectsCrossOwnerResponder()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);

        var (owner, _) = await ResponderClientAsync(admin, $"owner-{Guid.NewGuid():N}");
        var patient = await (await owner.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>();

        var ownerExport = await owner.GetAsync($"/api/persons/{patient!.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.OK, ownerExport.StatusCode);

        var (otherResponder, _) = await ResponderClientAsync(admin, $"other-{Guid.NewGuid():N}");
        var crossOwnerExport = await otherResponder.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.Forbidden, crossOwnerExport.StatusCode);

        var leitstelle = await LeitstelleClientAsync(admin);
        var leitstelleExport = await leitstelle.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.OK, leitstelleExport.StatusCode);
    }

    [Fact]
    public async Task ProtocolExport_QrSessionIsForbidden_WithoutAuditOrArchiveSideEffects()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var genRes = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = sceneId });
        var codes = await genRes.Content.ReadFromJsonAsync<QrCode[]>();

        var qrClient = factory.CreateClient();
        var login = await qrClient.PostAsJsonAsync("/api/qr-login", new { qr_code = codes![0].qrToken });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        qrClient.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var patient = await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId }))
            .Content.ReadFromJsonAsync<PatientBearing>();

        var auditBefore = await ExportAuditCountAsync(admin, patient!.id);
        var archiveBefore = await ExportArchiveCountAsync(patient.id);

        var forbidden = await qrClient.GetAsync($"/api/persons/{patient.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        Assert.Equal(auditBefore, await ExportAuditCountAsync(admin, patient.id));
        Assert.Equal(archiveBefore, await ExportArchiveCountAsync(patient.id));
    }
}
