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
    private List<Action>? pendingPatientWrite;
    public void BeginPatientWrite() => pendingPatientWrite = [];
    public void CommitPatientWrite()
    {
        var pending = pendingPatientWrite;
        pendingPatientWrite = null;
        if (pending is not null) foreach (var publish in pending) publish();
    }
    public void DiscardPatientWrite() => pendingPatientWrite = null;
    private void Publish(string group, string method, object message)
    {
        if (pendingPatientWrite is not null) pendingPatientWrite.Add(() => publisher.Publish(group, method, message));
        else publisher.Publish(group, method, message);
    }

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
        Publish(SceneHub.GroupName(sceneId), "PatientUpdated", new PatientUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, created, patientMapper.Map(PatientResponse.From(patient)), bodyParts, protokollStatus));
    }

    public void TeamUpdated(int sceneId, TeamResponse team) =>
        Publish(SceneHub.GroupName(sceneId), "TeamUpdated", new TeamUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, team));

    public void ScenePatientList(int sceneId, List<int> patientIds) =>
        Publish(SceneHub.GroupName(sceneId), "ScenePatientList", new ScenePatientListMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, patientIds));
}
