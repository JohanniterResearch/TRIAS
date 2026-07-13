namespace Ambulanzsystem.Api.Domain;

public class AmbulanzprotokollPage1 : AuditableEntity
{
    public int Id { get; set; }

    public int PatientId { get; set; }
    public Patient Patient { get; set; } = null!;

    // Raw jsonb text conforming to contract/schemas/ambulanzprotokoll-page1.schema.json.
    // Only ever holds data the responder actually entered — never the default template; GET
    // reconstructs the full shape by deep-merging this against the default (see FormStateMerge).
    public string FormStateJson { get; set; } = "{}";

    // Per-leaf-path last-write-wins timestamps (dot-path -> effective write time), same purpose
    // as Patient.FieldTimestampsJson but for the deep formState tree (NFR-SAFE-08/09).
    public string FieldTimestampsJson { get; set; } = "{}";

    public string Status { get; set; } = "draft"; // draft|finalized
    public DateTime? FinalizedAt { get; set; }
}
