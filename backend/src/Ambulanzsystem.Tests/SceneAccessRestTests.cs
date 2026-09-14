using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// REST counterpart to SceneHubTests: same SceneAccess.CanAccessAsync rule, now gating patient,
// body, team, and protocol endpoints instead of the SignalR hub's JoinScene.
public class SceneAccessRestTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id, int operationSceneId);
    private record TeamBearing(int id);
    private record QrCode(string qrToken);

    // The admin/login endpoints share a 10-req/60s-per-IP rate limit (NFR-SEC-05); this test class
    // logs in as admin far more often than a single scenario needs, so the admin token is cached
    // per WebApplicationFactory instance instead of re-authenticating in every test method.
    private static readonly ConcurrentDictionary<WebApplicationFactory<Program>, Task<string>> AdminTokens = new();

    private Task<string> AdminTokenAsync() => AdminTokens.GetOrAdd(factory, f =>
        TestAuth.LoginAsync(f.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await AdminTokenAsync());
        return client;
    }

    // A QR session (TokenTypes.Qr) is scoped to eventSceneId per SceneAccess: allowed for
    // eventSceneId itself and its direct children, forbidden everywhere else.
    private async Task<HttpClient> QrSessionClientAsync(HttpClient admin, int eventSceneId)
    {
        var genRes = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId });
        var codes = await genRes.Content.ReadFromJsonAsync<QrCode[]>();

        var qrClient = factory.CreateClient();
        var login = await qrClient.PostAsJsonAsync("/api/qr-login", new { qr_code = codes![0].qrToken });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        qrClient.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return qrClient;
    }

    // Event-scoped Leitstelle (Role.Leitstelle + AccountType.Event + EventSceneId): the coordinator's
    // required fix — a scoped Leitstelle must fall through to the same event/sub-site check as
    // responders/QR, not short-circuit to global like an unscoped Leitstelle does.
    private async Task<HttpClient> ScopedLeitstelleClientAsync(HttpClient admin, int eventSceneId)
    {
        var username = $"leitstelle-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new
        {
            username,
            password = "somePassword1",
            role = "leitstelle",
            accountType = "event",
            eventSceneId,
        });
        create.EnsureSuccessStatusCode();

        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", username, "somePassword1");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private async Task<int> CreateSceneAsync(HttpClient admin, string name, int? parentSceneId = null)
    {
        var body = parentSceneId is null
            ? (object)new { name }
            : new { name, parentSceneId };
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", body))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        return scene.id;
    }

    private async Task<PatientBearing> CreatePatientAsync(HttpClient client, int sceneId)
    {
        var res = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadFromJsonAsync<PatientBearing>())!;
    }

    [Fact]
    public async Task PatientList_AllowedForEventSceneAndItsSubSite_ForbiddenForOtherEvent()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var subSite = await CreateSceneAsync(admin, $"sub-{Guid.NewGuid():N}", eventA);
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var qr = await QrSessionClientAsync(admin, eventA);

        var ownScene = await qr.GetAsync($"/api/persons?operationSceneId={eventA}");
        Assert.Equal(HttpStatusCode.OK, ownScene.StatusCode);

        var subSiteScene = await qr.GetAsync($"/api/persons?operationSceneId={subSite}");
        Assert.Equal(HttpStatusCode.OK, subSiteScene.StatusCode);

        var otherEvent = await qr.GetAsync($"/api/persons?operationSceneId={eventB}");
        Assert.Equal(HttpStatusCode.Forbidden, otherEvent.StatusCode);
    }

    [Fact]
    public async Task PatientUpdate_ForbiddenOutsideScope_NotFoundWhenPatientDoesNotExist()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var patientInA = await CreatePatientAsync(admin, eventA);
        var patientInB = await CreatePatientAsync(admin, eventB);

        var qr = await QrSessionClientAsync(admin, eventA);

        var ok = await qr.PostAsJsonAsync($"/api/persons/{patientInA.id}/update-triage-color", new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var forbidden = await qr.PostAsJsonAsync($"/api/persons/{patientInB.id}/update-triage-color", new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        var missingId = patientInB.id + 1_000_000;
        var notFound = await qr.PostAsJsonAsync($"/api/persons/{missingId}/update-triage-color", new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
    }

    [Fact]
    public async Task BodyRecord_GetAndPut_AreSceneScoped()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var patientInA = await CreatePatientAsync(admin, eventA);
        var patientInB = await CreatePatientAsync(admin, eventB);

        var qr = await QrSessionClientAsync(admin, eventA);

        var getOwn = await qr.GetAsync($"/api/body-parts?idpatient={patientInA.id}");
        Assert.Equal(HttpStatusCode.OK, getOwn.StatusCode);

        var getForbidden = await qr.GetAsync($"/api/body-parts?idpatient={patientInB.id}");
        Assert.Equal(HttpStatusCode.Forbidden, getForbidden.StatusCode);

        var missingId = patientInB.id + 1_000_000;
        var getNotFound = await qr.GetAsync($"/api/body-parts?idpatient={missingId}");
        Assert.Equal(HttpStatusCode.NotFound, getNotFound.StatusCode);

        var putOwn = await qr.PutAsJsonAsync("/api/body-parts", new { idpatient = patientInA.id, bodyPartId = "kopf_vorne", isClicked = true });
        Assert.Equal(HttpStatusCode.OK, putOwn.StatusCode);

        var putForbidden = await qr.PutAsJsonAsync("/api/body-parts", new { idpatient = patientInB.id, bodyPartId = "kopf_vorne", isClicked = true });
        Assert.Equal(HttpStatusCode.Forbidden, putForbidden.StatusCode);
    }

    [Fact]
    public async Task Teams_ListAndUpdate_AreSceneScoped()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var teamInA = (await (await admin.PostAsJsonAsync("/api/teams", new { operationSceneId = eventA, name = "Team A" }))
            .Content.ReadFromJsonAsync<TeamBearing>())!;
        var teamInB = (await (await admin.PostAsJsonAsync("/api/teams", new { operationSceneId = eventB, name = "Team B" }))
            .Content.ReadFromJsonAsync<TeamBearing>())!;
        var patientInA = await CreatePatientAsync(admin, eventA);
        var patientInB = await CreatePatientAsync(admin, eventB);

        var qr = await QrSessionClientAsync(admin, eventA);

        var listOwn = await qr.GetAsync($"/api/teams?operationSceneId={eventA}");
        Assert.Equal(HttpStatusCode.OK, listOwn.StatusCode);

        var listForbidden = await qr.GetAsync($"/api/teams?operationSceneId={eventB}");
        Assert.Equal(HttpStatusCode.Forbidden, listForbidden.StatusCode);

        var updateOwn = await qr.PutAsJsonAsync($"/api/teams/{teamInA.id}", new { status = "busy" });
        Assert.Equal(HttpStatusCode.OK, updateOwn.StatusCode);

        var assignOwn = await qr.PutAsJsonAsync(
            $"/api/teams/{teamInA.id}", new { assignedPatientId = patientInA.id });
        Assert.Equal(HttpStatusCode.OK, assignOwn.StatusCode);

        var assignOtherScene = await qr.PutAsJsonAsync(
            $"/api/teams/{teamInA.id}", new { assignedPatientId = patientInB.id });
        Assert.Equal(HttpStatusCode.BadRequest, assignOtherScene.StatusCode);

        var updateForbidden = await qr.PutAsJsonAsync($"/api/teams/{teamInB.id}", new { status = "busy" });
        Assert.Equal(HttpStatusCode.Forbidden, updateForbidden.StatusCode);

        var missingId = teamInB.id + 1_000_000;
        var updateNotFound = await qr.PutAsJsonAsync($"/api/teams/{missingId}", new { status = "busy" });
        Assert.Equal(HttpStatusCode.NotFound, updateNotFound.StatusCode);
    }

    [Fact]
    public async Task Protocol_GetPutAndExport_AreSceneScoped()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var patientInA = await CreatePatientAsync(admin, eventA);
        var patientInB = await CreatePatientAsync(admin, eventB);

        var qr = await QrSessionClientAsync(admin, eventA);

        var getOwn = await qr.GetAsync($"/api/persons/{patientInA.id}/ambulanzprotokoll-page1");
        Assert.Equal(HttpStatusCode.OK, getOwn.StatusCode);

        var getForbidden = await qr.GetAsync($"/api/persons/{patientInB.id}/ambulanzprotokoll-page1");
        Assert.Equal(HttpStatusCode.Forbidden, getForbidden.StatusCode);

        // Keep the record in draft: a finalized record returns Forbid() for an unrelated reason
        // (CanCorrectFinalized), which would mask the scene-scope check under test here.
        var putOwn = await qr.PutAsJsonAsync($"/api/persons/{patientInA.id}/ambulanzprotokoll-page1",
            new { status = "draft", formState = new { } });
        Assert.Equal(HttpStatusCode.OK, putOwn.StatusCode);

        var putForbidden = await qr.PutAsJsonAsync($"/api/persons/{patientInB.id}/ambulanzprotokoll-page1",
            new { status = "draft", formState = new { } });
        Assert.Equal(HttpStatusCode.Forbidden, putForbidden.StatusCode);

        // Export is stricter than draft read/write: QR sessions can document within scene scope,
        // but cannot create archival exports because they are anonymous and non-owning.
        var exportOwn = await qr.GetAsync($"/api/persons/{patientInA.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.Forbidden, exportOwn.StatusCode);

        var exportForbidden = await qr.GetAsync($"/api/persons/{patientInB.id}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.Forbidden, exportForbidden.StatusCode);

        var missingId = patientInB.id + 1_000_000;
        var exportNotFound = await qr.GetAsync($"/api/persons/{missingId}/ambulanzprotokoll-page1/export");
        Assert.Equal(HttpStatusCode.NotFound, exportNotFound.StatusCode);
    }

    [Fact]
    public async Task QrPatientMove_AllowedWithinScope_ForbiddenWhenDestinationOutOfScope()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var subSite = await CreateSceneAsync(admin, $"sub-{Guid.NewGuid():N}", eventA);
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var genRes = await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 });
        var qrToken = (await genRes.Content.ReadFromJsonAsync<string[]>())![0];

        var qr = await QrSessionClientAsync(admin, eventA);

        // Create the QR-bound patient in the session's own scene.
        var create = await qr.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = eventA });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        // Move within scope: eventA -> subSite (both accessible) must succeed.
        var moveWithinScope = await qr.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = subSite });
        Assert.Equal(HttpStatusCode.OK, moveWithinScope.StatusCode);
        var movedPatient = await moveWithinScope.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(subSite, movedPatient.GetProperty("patient").GetProperty("operationSceneId").GetInt32());

        // Move to an out-of-scope destination must be rejected, and must not mutate the patient.
        var moveOutOfScope = await qr.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = eventB });
        Assert.Equal(HttpStatusCode.Forbidden, moveOutOfScope.StatusCode);

        var afterFailedMove = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = subSite });
        var afterFailedMoveBody = await afterFailedMove.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(subSite, afterFailedMoveBody.GetProperty("patient").GetProperty("operationSceneId").GetInt32());
    }

    [Fact]
    public async Task QrPatientMove_ForbiddenWhenCurrentSceneOutOfScope()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var genRes = await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 });
        var qrToken = (await genRes.Content.ReadFromJsonAsync<string[]>())![0];

        // Patient is created directly in eventB (out of the eventA session's scope) by admin.
        var create = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = eventB });
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);

        var qr = await QrSessionClientAsync(admin, eventA);

        // Attempting to move it into the session's own (in-scope) scene must still fail: the
        // *current* scene (eventB) is out of scope, so the session has no authority over this
        // patient at all.
        var moveAttempt = await qr.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = eventA });
        Assert.Equal(HttpStatusCode.Forbidden, moveAttempt.StatusCode);

        var afterFailedMove = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = qrToken, operationSceneId = eventB });
        var afterFailedMoveBody = await afterFailedMove.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(eventB, afterFailedMoveBody.GetProperty("patient").GetProperty("operationSceneId").GetInt32());
    }

    [Fact]
    public async Task EventScopedLeitstelle_AllowedInOwnEventAndSubSite_ForbiddenInOtherEvent()
    {
        var admin = await AdminClientAsync();
        var eventA = await CreateSceneAsync(admin, $"event-a-{Guid.NewGuid():N}");
        var subSite = await CreateSceneAsync(admin, $"sub-{Guid.NewGuid():N}", eventA);
        var eventB = await CreateSceneAsync(admin, $"event-b-{Guid.NewGuid():N}");

        var patientInSubSite = await CreatePatientAsync(admin, subSite);
        var patientInB = await CreatePatientAsync(admin, eventB);

        var leitstelle = await ScopedLeitstelleClientAsync(admin, eventA);

        var ownEvent = await leitstelle.GetAsync($"/api/persons?operationSceneId={eventA}");
        Assert.Equal(HttpStatusCode.OK, ownEvent.StatusCode);

        var ownSubSite = await leitstelle.GetAsync($"/api/persons?operationSceneId={subSite}");
        Assert.Equal(HttpStatusCode.OK, ownSubSite.StatusCode);

        var otherEvent = await leitstelle.GetAsync($"/api/persons?operationSceneId={eventB}");
        Assert.Equal(HttpStatusCode.Forbidden, otherEvent.StatusCode);

        var updateOwnSubSitePatient = await leitstelle.PostAsJsonAsync(
            $"/api/persons/{patientInSubSite.id}/update-triage-color", new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.OK, updateOwnSubSitePatient.StatusCode);

        var updateOtherEventPatient = await leitstelle.PostAsJsonAsync(
            $"/api/persons/{patientInB.id}/update-triage-color", new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.Forbidden, updateOtherEventPatient.StatusCode);
    }
}
