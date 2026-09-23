using System.Net.Http.Json;
using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Ambulanzsystem.Tests;

public class AdminPatientSearchTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private record Scene(int id);
    private record Patient(int id);
    private record VerifyResult(Patient patient);

    [Fact]
    public async Task NumericSearch_FindsUnnamedQrPatient_WithoutReturningItsPrimaryKey()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(admin, "/api/admin-login", "admin", "dev-admin-password"));
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"admin-search-{Guid.NewGuid():N}" }))
            .Content.ReadFromJsonAsync<Scene>())!;
        var code = (await (await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 }))
            .Content.ReadFromJsonAsync<string[]>())![0];
        var created = (await (await admin.PostAsJsonAsync("/api/verify-patient-qr-code", new { qr_code = code, operationSceneId = scene.id }))
            .Content.ReadFromJsonAsync<VerifyResult>())!;

        var result = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/patients?search={created.patient.id}");
        var patient = result.GetProperty("items").EnumerateArray().Single();

        Assert.True(patient.TryGetProperty("editReference", out var reference));
        Assert.False(patient.TryGetProperty("id", out _));
        Assert.False(string.IsNullOrWhiteSpace(reference.GetString()));
    }

    [Fact]
    public async Task UserSearch_AppliesRoleAccountTypeAndStatusFilters()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(admin, "/api/admin-login", "admin", "dev-admin-password"));
        var username = $"admin-filter-{Guid.NewGuid():N}";
        var created = await admin.PostAsJsonAsync("/api/users", new { username, password = "password1", role = "responder", accountType = "permanent" });
        created.EnsureSuccessStatusCode();
        var user = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();

        var active = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/users?role=responder&accountType=permanent&status=active&search={username}");
        Assert.Contains(active.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetInt32() == user);

        (await admin.PostAsync($"/api/users/{user}/revoke", null)).EnsureSuccessStatusCode();
        var revoked = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/users?status=revoked&search={username}");
        Assert.Contains(revoked.GetProperty("items").EnumerateArray(), item => item.GetProperty("id").GetInt32() == user);
    }

    [Fact]
    public async Task DetailedCorrectionRoutes_UseOpaqueReference_AndKeepProtocolReadOnly()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(admin, "/api/admin-login", "admin", "dev-admin-password"));
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"admin-detail-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Scene>())!;
        var patient = await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id, name = "Detail test" });
        patient.EnsureSuccessStatusCode();
        var id = (await patient.Content.ReadFromJsonAsync<Patient>())!.id;
        var search = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/patients?search={id}");
        var reference = search!.GetProperty("items")[0].GetProperty("editReference").GetString()!;

        var details = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/patients/{Uri.EscapeDataString(reference)}/details");
        Assert.DoesNotContain("\"id\":", details!.GetRawText());
        var parts = details.GetProperty("bodyParts").Deserialize<Dictionary<string, int>>()!;
        parts["kopf_vorne"] = 1;
        (await admin.PutAsJsonAsync($"/api/admin/patients/{Uri.EscapeDataString(reference)}/body-parts", new { bodyParts = parts, correctionReason = "Körperkarte berichtigt" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PutAsJsonAsync($"/api/admin/patients/{Uri.EscapeDataString(reference)}/ambulanzprotokoll-page1", new { })).StatusCode);
    }

    [Fact]
    public async Task AdminQrAssignment_UsesOpaqueReferences_AndReturnsNewTokenOnlyForPrinting()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(admin, "/api/admin-login", "admin", "dev-admin-password"));
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"admin-qr-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Scene>())!;
        var patient = await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id, name = "QR test" });
        var id = (await patient.Content.ReadFromJsonAsync<Patient>())!.id;
        var search = await admin.GetFromJsonAsync<JsonElement>($"/api/admin/patients?search={id}");
        var patientReference = search!.GetProperty("items")[0].GetProperty("editReference").GetString()!;
        (await admin.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 1 })).EnsureSuccessStatusCode();

        var available = await admin.GetFromJsonAsync<JsonElement>("/api/admin/patient-qr-codes/available");
        var code = available!.GetProperty("items")[0];
        Assert.True(code.TryGetProperty("reference", out var qrReference));
        Assert.False(code.TryGetProperty("id", out _));
        Assert.False(code.TryGetProperty("qrToken", out _));

        var existing = await admin.PostAsJsonAsync($"/api/admin/patients/{Uri.EscapeDataString(patientReference)}/assign-qr-code", new { source = "existing", qrReference = qrReference.GetString() });
        existing.EnsureSuccessStatusCode();
        Assert.True((await existing.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("printableQrToken").ValueKind == JsonValueKind.Null);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/admin/patients/{Uri.EscapeDataString(patientReference)}/assign-qr-code", new { source = "existing", qrReference = qrReference.GetString() })).StatusCode);

        var generated = await admin.PostAsJsonAsync($"/api/admin/patients/{Uri.EscapeDataString(patientReference)}/assign-qr-code", new { source = "new" });
        generated.EnsureSuccessStatusCode();
        Assert.False(string.IsNullOrWhiteSpace((await generated.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("printableQrToken").GetString()));
        var details = await admin.GetStringAsync($"/api/admin/patients/{Uri.EscapeDataString(patientReference)}/details");
        Assert.DoesNotContain("printableQrToken", details);
        Assert.DoesNotContain("qrToken", details);
    }

    [Fact]
    public async Task AdminQrRoutes_RequireAdmin()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/api/admin/patient-qr-codes/available")).StatusCode);
    }
}
