namespace Ambulanzsystem.Api.Domain;

public class LocationProcessedWrite
{
    public int PatientId { get; set; }
    public Guid WriteId { get; set; }
    public string Checksum { get; set; } = null!;
    public string? DecisionsJson { get; set; }
    public DateTime ProcessedAt { get; set; }
}
