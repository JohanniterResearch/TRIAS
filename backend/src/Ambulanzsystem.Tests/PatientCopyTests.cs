using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Ambulanzsystem.Tests;

public class PatientCopyTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record SceneBearing(int id);
    private record PatientBearing(int id, int operationSceneId, int? copiedFromPatientId, string? triagefarbe, bool? atmung, bool? blutung);
    private record VerifyResult(PatientBearing patient, bool created);

    private async Task<HttpClient> AdminClientAsync()
    {
        var client = factory.CreateClient();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password");
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    [Fact]
    public async Task ScanInDifferentScene_CreatesCopyReferencingOriginal_AndLeavesOriginalUnchanged()
    {
        var admin = await AdminClientAsync();

        var scene1 = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-orig-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var scene2 = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-copy-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var generated = await (await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 }))
            .Content.ReadFromJsonAsync<string[]>();
        var code = generated![0];

        // 1. Initial scan in scene1 creates the original patient
        var res1 = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene1.id });
        Assert.Equal(HttpStatusCode.Created, res1.StatusCode);
        var origVerify = (await res1.Content.ReadFromJsonAsync<VerifyResult>())!;
        Assert.True(origVerify.created);
        Assert.Null(origVerify.patient.copiedFromPatientId);
        Assert.Equal(scene1.id, origVerify.patient.operationSceneId);

        // Update triage data on original patient
        var updateRes = await admin.PostAsJsonAsync($"/api/persons/{origVerify.patient.id}/update-triage-color", new
        {
            triageColor = "rot",
            respiration = true,
            blutung = false,
        });
        updateRes.EnsureSuccessStatusCode();

        // 2. Scan same code in scene2 creates a copy with original's triage state snapshot
        var res2 = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene2.id });
        Assert.Equal(HttpStatusCode.Created, res2.StatusCode);
        var copyVerify = (await res2.Content.ReadFromJsonAsync<VerifyResult>())!;
        Assert.True(copyVerify.created);
        Assert.NotEqual(origVerify.patient.id, copyVerify.patient.id);
        Assert.Equal(scene2.id, copyVerify.patient.operationSceneId);
        Assert.Equal(origVerify.patient.id, copyVerify.patient.copiedFromPatientId);
        Assert.Equal("rot", copyVerify.patient.triagefarbe);
        Assert.True(copyVerify.patient.atmung);
        Assert.False(copyVerify.patient.blutung);

        // 3. Scan again in scene1 returns the original (not modified and not duplicated)
        var resOrigAgain = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene1.id });
        Assert.Equal(HttpStatusCode.OK, resOrigAgain.StatusCode);
        var origAgainVerify = (await resOrigAgain.Content.ReadFromJsonAsync<VerifyResult>())!;
        Assert.False(origAgainVerify.created);
        Assert.Equal(origVerify.patient.id, origAgainVerify.patient.id);
        Assert.Equal(scene1.id, origAgainVerify.patient.operationSceneId);

        // 4. Scan again in scene2 returns the existing copy (not duplicated)
        var resCopyAgain = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene2.id });
        Assert.Equal(HttpStatusCode.OK, resCopyAgain.StatusCode);
        var copyAgainVerify = (await resCopyAgain.Content.ReadFromJsonAsync<VerifyResult>())!;
        Assert.False(copyAgainVerify.created);
        Assert.Equal(copyVerify.patient.id, copyAgainVerify.patient.id);
        Assert.Equal(scene2.id, copyAgainVerify.patient.operationSceneId);

        // 5. Verify audit log entry for copy creation
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var copyAuditLogs = await db.AuditLogs
            .Where(a => a.PatientId == copyVerify.patient.id && a.Action == "write")
            .ToListAsync();
        Assert.Contains(copyAuditLogs, a => a.ChangedFieldsJson != null && a.ChangedFieldsJson.Contains("created") && a.AfterJson != null && a.AfterJson.Contains("copy"));
        Assert.Contains(copyAuditLogs, a => a.ChangedFieldsJson != null && a.ChangedFieldsJson.Contains("copiedFromPatientId") && a.AfterJson != null && a.AfterJson.Contains(origVerify.patient.id.ToString()));
    }

    [Fact]
    public async Task ConcurrentScansInSecondScene_CreateExactlyOneCopy()
    {
        var admin = await AdminClientAsync();

        var scene1 = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-c1-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;
        var scene2 = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"scene-c2-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<SceneBearing>())!;

        var generated = await (await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 }))
            .Content.ReadFromJsonAsync<string[]>();
        var code = generated![0];

        // Create original in scene1
        var createOrig = await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene1.id });
        createOrig.EnsureSuccessStatusCode();
        var origVerify = (await createOrig.Content.ReadFromJsonAsync<VerifyResult>())!;

        var token = admin.DefaultRequestHeaders.Authorization!.Parameter;
        var tasks = Enumerable.Range(0, 10).Select(async _ =>
        {
            var client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            var res = await client.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene2.id });
            res.EnsureSuccessStatusCode();
            return (await res.Content.ReadFromJsonAsync<VerifyResult>())!;
        });

        var results = await Task.WhenAll(tasks);

        var distinctCopyPatientIds = results.Select(r => r.patient.id).Distinct().ToList();
        Assert.Single(distinctCopyPatientIds);
        Assert.Single(results, r => r.created);
        Assert.All(results, r => Assert.Equal(origVerify.patient.id, r.patient.copiedFromPatientId));
        Assert.All(results, r => Assert.Equal(scene2.id, r.patient.operationSceneId));
    }
}
