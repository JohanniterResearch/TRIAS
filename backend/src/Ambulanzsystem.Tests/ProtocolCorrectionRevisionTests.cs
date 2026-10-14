using System.Net;
using System.Net.Http.Json;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Ambulanzsystem.Tests;

// PLS parity plan Phase 4 exit: correcting a finalized protocol creates a new revision that keeps
// the reason, and the finalized version before it stays as the earlier revision.
public class ProtocolCorrectionRevisionTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private record Bearing(int id);

    [Fact]
    public async Task CorrectingAFinalizedProtocol_CreatesANewRevisionWithTheReason()
    {
        var admin = factory.CreateClient();
        admin.DefaultRequestHeaders.Authorization = new("Bearer",
            await TestAuth.LoginAsync(factory.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"rev-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Bearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id, clientGeneratedId = Guid.NewGuid() })).Content.ReadFromJsonAsync<Bearing>())!;
        var path = $"/api/persons/{patient.id}/ambulanzprotokoll-page1";

        (await admin.PutAsJsonAsync(path, new { status = "finalized", formState = new { incident = new { ambulanzort = "Erstfassung" } } })).EnsureSuccessStatusCode();

        var withoutReason = await admin.PutAsJsonAsync(path, new { status = "finalized", formState = new { incident = new { ambulanzort = "Korrigiert" } } });
        Assert.Equal(HttpStatusCode.BadRequest, withoutReason.StatusCode);

        (await admin.PutAsJsonAsync(path, new
        {
            status = "finalized",
            formState = new { incident = new { ambulanzort = "Korrigiert" } },
            correctionReason = "Ort falsch erfasst",
        })).EnsureSuccessStatusCode();

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var revisions = await db.AmbulanzprotokollRevisions.Where(r => r.PatientId == patient.id).OrderBy(r => r.Version).ToListAsync();

        Assert.Equal([1, 2], revisions.Select(r => r.Version));
        Assert.Null(revisions[0].CorrectionReason);
        Assert.Contains("Erstfassung", revisions[0].FormStateSnapshotJson);
        Assert.Equal("Ort falsch erfasst", revisions[1].CorrectionReason);
        Assert.Contains("Korrigiert", revisions[1].FormStateSnapshotJson);
    }
}
