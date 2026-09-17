using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the dev docker-compose Postgres, same convention as AuthFlowTests.
public class AmbulanzprotokollTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record TokenBearing(string? token);
    private record SceneBearing(int id);
    private record PatientBearing(int id);
    private static readonly ConcurrentDictionary<WebApplicationFactory<Program>, Task<string>> AdminTokens = new();

    private Task<string> AdminTokenAsync() => AdminTokens.GetOrAdd(factory, f =>
        TestAuth.LoginAsync(f.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await AdminTokenAsync());
        return client;
    }

    private async Task<int> CreatePatientAsync(HttpClient admin)
    {
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"protokoll-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<PatientBearing>())!;
        return patient.id;
    }

    private async Task<int> CreateSceneAsync(HttpClient admin)
    {
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"protokoll-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        return scene.id;
    }

    private async Task<(HttpClient client, int userId)> ResponderClientAsync(HttpClient admin)
    {
        var username = $"responder-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "responder" });
        create.EnsureSuccessStatusCode();
        var userId = (await create.Content.ReadFromJsonAsync<PatientBearing>())!.id; // {id} shape shared with PatientBearing

        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/user-login", username, "somePassword1");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return (client, userId);
    }

    private record QrCode(string qrToken);

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

    [Fact]
    public async Task Merge_EmptyFieldInNewSave_NeverDeletesNonEmptyExistingValue()
    {
        // The core NFR-SAFE-09 safety property: a second device syncing a draft that never saw
        // an already-recorded field must not wipe it out, even though its PUT is chronologically
        // later. This is the specific behavior FormStateMerge.IsEmpty + the "rule 1" skip exist
        // to guarantee — losing recorded patient data is the failure mode this whole mechanism
        // is built to prevent.
        var client = await AdminClientAsync();
        var patientId = await CreatePatientAsync(client);

        var first = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "Mustermann" } },
        });
        first.EnsureSuccessStatusCode();

        var second = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "draft",
            formState = new { patient = new { familienname = "" }, history = new { allergien = "Penicillin" } },
        });
        second.EnsureSuccessStatusCode();

        var body = await second.Content.ReadFromJsonAsync<JsonElement>();
        var formState = body.GetProperty("formState");

        Assert.Equal("Mustermann", formState.GetProperty("patient").GetProperty("familienname").GetString());
        Assert.Equal("Penicillin", formState.GetProperty("history").GetProperty("allergien").GetString());
    }

    [Fact]
    public async Task Finalize_WithIncompleteForm_Succeeds_WithWarnings()
    {
        var client = await AdminClientAsync();
        var patientId = await CreatePatientAsync(client);

        var res = await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
        {
            status = "finalized",
            formState = new { },
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("finalized", body.GetProperty("status").GetString());
        Assert.True(body.GetProperty("warnings").GetArrayLength() > 0);
    }

    [Fact]
    public async Task FinalizedRecord_CannotBeCorrectedByAnUnrelatedResponder()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin);

        var finalize = await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        finalize.EnsureSuccessStatusCode();

        var username = $"unrelated-{Guid.NewGuid():N}";
        var create = await admin.PostAsJsonAsync("/api/users", new { username, password = "somePassword1", role = "responder" });
        create.EnsureSuccessStatusCode();

        var responder = factory.CreateClient();
        var login = await responder.PostAsJsonAsync("/api/user-login", new { username, password = "somePassword1" });
        var token = (await login.Content.ReadFromJsonAsync<TokenBearing>())!.token!;
        responder.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var attempt = await responder.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });

        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }

    [Fact]
    public async Task ResponderWhoCreatedPatient_CanCorrectOwnFinalizedRecord()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var (responder, _) = await ResponderClientAsync(admin);

        var create = await responder.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        create.EnsureSuccessStatusCode();
        var patientId = (await create.Content.ReadFromJsonAsync<PatientBearing>())!.id;

        var finalize = await responder.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        finalize.EnsureSuccessStatusCode();

        // Same responder owns the patient it created — must be able to correct its own
        // finalized record, not just Admin/Leitstelle (FR-DOC-11/12).
        var correction = await responder.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { patient = new { familienname = "Corrected" } }, correctionReason = "Name correction" });

        Assert.Equal(HttpStatusCode.OK, correction.StatusCode);
    }

    [Fact]
    public async Task AnotherResponder_CannotCorrectFinalizedRecord_OwnedByADifferentResponder()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var (owner, _) = await ResponderClientAsync(admin);
        var (other, _) = await ResponderClientAsync(admin);

        var create = await owner.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        create.EnsureSuccessStatusCode();
        var patientId = (await create.Content.ReadFromJsonAsync<PatientBearing>())!.id;

        var finalize = await owner.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        finalize.EnsureSuccessStatusCode();

        var attempt = await other.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });

        Assert.Equal(HttpStatusCode.Forbidden, attempt.StatusCode);
    }

    private record PatientQrCode(string qrToken);

    [Fact]
    public async Task AnonymousQrCreatedPatient_FinalizedRecord_OnlyCorrectableByAdminOrLeitstelle()
    {
        var admin = await AdminClientAsync();
        var sceneId = await CreateSceneAsync(admin);
        var qrSession = await QrSessionClientAsync(admin, sceneId);

        // Anonymous QR *session* (login-qr-codes) scans a patient QR *tag* (patient-qr-codes) to
        // create the record — the real "QR intake" path (PersonsController.VerifyQrCode), not
        // manual entry. No stable identity to own it (FR-AUTH-07), so Patient.UserIdUser must
        // stay null and only Admin/Leitstelle may correct the finalized record.
        var generated = await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 });
        var patientQrCode = (await generated.Content.ReadFromJsonAsync<string[]>())![0];

        var create = await qrSession.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = patientQrCode, operationSceneId = sceneId });
        create.EnsureSuccessStatusCode();
        var patientId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("patient").GetProperty("id").GetInt32();

        var finalize = await qrSession.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        finalize.EnsureSuccessStatusCode();

        var (responder, _) = await ResponderClientAsync(admin);
        var responderAttempt = await responder.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        Assert.Equal(HttpStatusCode.Forbidden, responderAttempt.StatusCode);

        var qrAttempt = await qrSession.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { } });
        Assert.Equal(HttpStatusCode.Forbidden, qrAttempt.StatusCode);

        var adminCorrection = await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "finalized", formState = new { patient = new { familienname = "Corrected" } }, correctionReason = "Name correction" });
        Assert.Equal(HttpStatusCode.OK, adminCorrection.StatusCode);
    }

    [Fact]
    public async Task ConcurrentUpdates_ToExistingRecord_PreserveDisjointLeavesAndRejectOlderReplay()
    {
        var admin = await AdminClientAsync();
        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var patientId = await CreatePatientAsync(admin);
            (await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
                new { status = "draft", formState = new { } })).EnsureSuccessStatusCode();

            var timestamp = DateTime.UtcNow.AddMinutes(-1);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var first = PutAsync(token, patientId, new
            {
                status = "draft",
                formState = new { vitals = new { puls = $"{80 + attempt}" } },
                clientUpdatedAt = timestamp,
            }, start.Task);
            var second = PutAsync(token, patientId, new
            {
                status = "draft",
                formState = new { patient = new { vorname = $"Parallel-{attempt}" } },
                clientUpdatedAt = timestamp,
            }, start.Task);

            start.SetResult();
            var responses = await Task.WhenAll(first, second);
            Assert.All(responses, response => response.EnsureSuccessStatusCode());

            var older = await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", new
            {
                status = "draft",
                formState = new { vitals = new { puls = "1" } },
                clientUpdatedAt = timestamp.AddMinutes(-1),
            });
            older.EnsureSuccessStatusCode();

            var record = await (await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1"))
                .Content.ReadFromJsonAsync<JsonElement>();
            var formState = record.GetProperty("formState");
            Assert.Equal($"{80 + attempt}", formState.GetProperty("vitals").GetProperty("puls").GetString());
            Assert.Equal($"Parallel-{attempt}", formState.GetProperty("patient").GetProperty("vorname").GetString());
        }
    }

    [Fact]
    public async Task ConcurrentFirstCreates_PreserveBothLeavesWithoutServerError()
    {
        var admin = await AdminClientAsync();
        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;

        for (var attempt = 0; attempt < 8; attempt++)
        {
            var patientId = await CreatePatientAsync(admin);
            var timestamp = DateTime.UtcNow.AddMinutes(-1);
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var requests = new[]
            {
                PutAsync(token, patientId, new
                {
                    status = "draft",
                    formState = new { vitals = new { puls = $"{90 + attempt}" } },
                    clientUpdatedAt = timestamp,
                }, start.Task),
                PutAsync(token, patientId, new
                {
                    status = "draft",
                    formState = new { patient = new { vorname = $"First-{attempt}" } },
                    clientUpdatedAt = timestamp,
                }, start.Task),
            };

            start.SetResult();
            var responses = await Task.WhenAll(requests);
            Assert.All(responses, response => response.EnsureSuccessStatusCode());
            var record = await (await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1"))
                .Content.ReadFromJsonAsync<JsonElement>();
            var formState = record.GetProperty("formState");
            Assert.Equal($"{90 + attempt}", formState.GetProperty("vitals").GetProperty("puls").GetString());
            Assert.Equal($"First-{attempt}", formState.GetProperty("patient").GetProperty("vorname").GetString());
        }
    }

    [Fact]
    public async Task ConcurrentFinalizationAndUnrelatedDraftSave_CannotLeaveRecordDraft()
    {
        var admin = await AdminClientAsync();
        var patientId = await CreatePatientAsync(admin);
        var (responder, _) = await ResponderClientAsync(admin);
        var adminToken = admin.DefaultRequestHeaders.Authorization!.Parameter;
        var responderToken = responder.DefaultRequestHeaders.Authorization!.Parameter;

        (await admin.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1",
            new { status = "draft", formState = new { } })).EnsureSuccessStatusCode();

        var responses = await Task.WhenAll(
            PutAsync(adminToken, patientId, new { status = "finalized", formState = new { } }),
            PutAsync(responderToken, patientId, new
            {
                status = "draft",
                formState = new { history = new { allergien = "concurrent" } },
            }));

        Assert.Equal(HttpStatusCode.OK, responses[0].StatusCode);
        Assert.Contains(responses[1].StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Forbidden });
        var record = await (await admin.GetAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1"))
            .Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("finalized", record.GetProperty("status").GetString());
    }

    private async Task<HttpResponseMessage> PutAsync(string? token, int patientId, object request, Task? start = null)
    {
        if (start is not null) await start;
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return await client.PutAsJsonAsync($"/api/persons/{patientId}/ambulanzprotokoll-page1", request);
    }
}
