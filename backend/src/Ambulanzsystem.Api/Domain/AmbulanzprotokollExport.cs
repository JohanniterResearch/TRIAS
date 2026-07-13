namespace Ambulanzsystem.Api.Domain;

// FR-DOC-14: exported documentation is retained in a long-term archive, distinct from the live
// (mutable, correctable) AmbulanzprotokollPage1 row — each export is an immutable snapshot.
public class AmbulanzprotokollExport
{
    public int Id { get; set; }

    public int PatientId { get; set; }
    public Patient Patient { get; set; } = null!;

    public string FormStateSnapshotJson { get; set; } = "{}";
    public string Status { get; set; } = null!; // draft|finalized, as of export time

    public DateTime GeneratedAt { get; set; }
    public int? ActorId { get; set; }
    public string ActorRole { get; set; } = null!;
    public string Watermark { get; set; } = null!;
    public string SchemaVersion { get; set; } = "1";

    public DateTime CreatedAt { get; set; }
}
