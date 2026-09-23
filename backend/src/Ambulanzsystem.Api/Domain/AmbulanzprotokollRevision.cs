namespace Ambulanzsystem.Api.Domain;

// Immutable snapshot of each finalized operational version. The live protocol remains the
// current version so existing readers and exports do not need a second code path.
public class AmbulanzprotokollRevision
{
    public long Id { get; set; }
    public int PatientId { get; set; }
    public int Version { get; set; }
    public string FormStateSnapshotJson { get; set; } = "{}";
    public DateTime FinalizedAt { get; set; }
    public int? ActorId { get; set; }
    public string ActorRole { get; set; } = null!;
    public string? CorrectionReason { get; set; }
}
