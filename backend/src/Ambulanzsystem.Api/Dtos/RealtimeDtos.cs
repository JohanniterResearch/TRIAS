namespace Ambulanzsystem.Api.Dtos;

// Shapes match contract/schemas/realtime-messages.md exactly.
public record SceneSnapshotMessage(
    string SchemaVersion,
    DateTime EventTimestamp,
    int SceneId,
    List<PatientResponse> Patients,
    List<TeamResponse> Teams);

public record PatientUpdatedMessage(
    string SchemaVersion,
    DateTime EventTimestamp,
    int SceneId,
    bool Created,
    PatientResponse Patient,
    Dictionary<string, int> BodyParts,
    string? ProtokollStatus);

public record TeamUpdatedMessage(
    string SchemaVersion,
    DateTime EventTimestamp,
    int SceneId,
    TeamResponse Team);

public record ScenePatientListMessage(
    string SchemaVersion,
    DateTime EventTimestamp,
    int SceneId,
    List<int> PatientIds);
