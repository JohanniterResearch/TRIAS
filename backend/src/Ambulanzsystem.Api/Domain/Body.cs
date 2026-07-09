namespace Ambulanzsystem.Api.Domain;

public class Body : AuditableEntity
{
    public int Id { get; set; }

    public int PatientId { get; set; }
    public Patient Patient { get; set; } = null!;

    // JSON object, one entry per key in contract/body-regions.json: 0 = unmarked, non-zero = marked.
    // Stored as raw jsonb text; (de)serialized by the body-parts service in B4 — kept a plain string
    // here so B1 doesn't need a value converter for a feature it doesn't implement yet.
    public string BodyPartsJson { get; set; } = "{}";
}
