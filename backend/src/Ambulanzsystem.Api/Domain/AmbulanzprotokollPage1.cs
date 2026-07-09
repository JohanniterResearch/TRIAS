namespace Ambulanzsystem.Api.Domain;

public class AmbulanzprotokollPage1 : AuditableEntity
{
    public int Id { get; set; }

    public int PatientId { get; set; }
    public Patient Patient { get; set; } = null!;

    // Raw jsonb text conforming to contract/schemas/ambulanzprotokoll-page1.schema.json.
    // (De)serialization and merge logic land in B5 — B1 only owns storage + the default shape.
    public string FormStateJson { get; set; } = "{}";

    public string Status { get; set; } = "draft"; // draft|finalized
    public DateTime? FinalizedAt { get; set; }
}
