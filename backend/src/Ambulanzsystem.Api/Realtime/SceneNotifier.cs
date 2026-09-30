using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Realtime;

// Thin facade so controllers don't need to know about group naming, schemaVersion, or the queue —
// just "this patient/team changed in this scene."
public class SceneNotifier(RealtimePublisher publisher, RealtimePatientMapper patientMapper, AppDbContext db)
{
    private const string SchemaVersion = "1";

    // Loads whichever of body parts / protocol status the caller does not already hold.
    public async Task PatientUpdatedAsync(Patient patient, bool created, string? protokollStatus = null, Dictionary<string, int>? bodyParts = null)
    {
        if (bodyParts is null)
        {
            var json = await db.Bodies.Where(b => b.PatientId == patient.Id).Select(b => b.BodyPartsJson).FirstOrDefaultAsync();
            bodyParts = json is null ? [] : JsonSerializer.Deserialize<Dictionary<string, int>>(json)!;
        }
        protokollStatus ??= await db.AmbulanzprotokollPage1s.Where(r => r.PatientId == patient.Id).Select(r => r.Status).FirstOrDefaultAsync();

        var sceneId = patient.OperationSceneId;
        publisher.Publish(SceneHub.GroupName(sceneId), "PatientUpdated", new PatientUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, created, patientMapper.Map(PatientResponse.From(patient)), bodyParts, protokollStatus));
    }

    public void TeamUpdated(int sceneId, TeamResponse team) =>
        publisher.Publish(SceneHub.GroupName(sceneId), "TeamUpdated", new TeamUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, team));

    public void ScenePatientList(int sceneId, List<int> patientIds) =>
        publisher.Publish(SceneHub.GroupName(sceneId), "ScenePatientList", new ScenePatientListMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, patientIds));
}
