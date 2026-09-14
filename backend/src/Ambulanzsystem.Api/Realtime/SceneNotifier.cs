using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Realtime;

// Thin facade so controllers don't need to know about group naming, schemaVersion, or the queue —
// just "this patient/team changed in this scene."
public class SceneNotifier(RealtimePublisher publisher, RealtimePatientMapper patientMapper)
{
    private const string SchemaVersion = "1";

    public void PatientUpdated(int sceneId, PatientResponse patient, Dictionary<string, int> bodyParts, bool created, string? protokollStatus) =>
        publisher.Publish(SceneHub.GroupName(sceneId), "PatientUpdated", new PatientUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, created, patientMapper.Map(patient), bodyParts, protokollStatus));

    public void TeamUpdated(int sceneId, TeamResponse team) =>
        publisher.Publish(SceneHub.GroupName(sceneId), "TeamUpdated", new TeamUpdatedMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, team));

    public void ScenePatientList(int sceneId, List<int> patientIds) =>
        publisher.Publish(SceneHub.GroupName(sceneId), "ScenePatientList", new ScenePatientListMessage(
            SchemaVersion, DateTime.UtcNow, sceneId, patientIds));
}
