using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ambulanzsystem.Tests;

// Decision D11: an unsent draft the device submits while its user logs out is stored with a flag
// (nobody reviewed it afterwards), the flag is audited, and the next normal save clears it.
public class ProtocolSentAtLogoutTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private record Bearing(int id);

    [Fact]
    public async Task ADraftSentAtLogout_IsFlaggedAudited_AndClearedByTheNextSave()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer",
            await TestAuth.LoginAsync(factory.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"logout-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Bearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id, clientGeneratedId = Guid.NewGuid() })).Content.ReadFromJsonAsync<Bearing>())!;
        var path = $"/api/persons/{patient.id}/ambulanzprotokoll-page1";

        var saved = await admin.PutAsJsonAsync(path, new { status = "draft", formState = new { incident = new { ambulanzort = "Zelt 2" } }, sentAtLogout = true });
        saved.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.String, (await saved.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sentAtLogoutAt").ValueKind);
        Assert.Equal(JsonValueKind.String, (await admin.GetFromJsonAsync<JsonElement>(path)).GetProperty("sentAtLogoutAt").ValueKind);

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var audited = await db.AuditLogs.Where(a => a.PatientId == patient.id && a.EntityType == "ambulanzprotokoll").Select(a => a.ChangedFieldsJson).ToListAsync();
            Assert.Contains(audited, fields => fields != null && fields.Contains("sentAtLogout"));
        }

        (await admin.PutAsJsonAsync(path, new { status = "draft", formState = new { incident = new { ambulanzort = "Zelt 3" } } })).EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await admin.GetFromJsonAsync<JsonElement>(path)).GetProperty("sentAtLogoutAt").ValueKind);
        // A finalization is a review: the flag is ignored there.
        var finalized = await admin.PutAsJsonAsync(path, new { status = "finalized", formState = new { incident = new { ambulanzort = "Zelt 3" } }, sentAtLogout = true });
        finalized.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await finalized.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sentAtLogoutAt").ValueKind);
        // A correction of a finalized record is a review too, whatever status it is saved with.
        var corrected = await admin.PutAsJsonAsync(path, new { status = "draft", correctionReason = "Tippfehler", formState = new { incident = new { ambulanzort = "Zelt 4" } }, sentAtLogout = true });
        corrected.EnsureSuccessStatusCode();
        Assert.Equal(JsonValueKind.Null, (await corrected.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("sentAtLogoutAt").ValueKind);
    }
}
