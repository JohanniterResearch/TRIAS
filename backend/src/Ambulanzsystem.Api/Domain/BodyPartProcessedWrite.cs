namespace Ambulanzsystem.Api.Domain;

public class BodyPartProcessedWrite
{
    public int PatientId { get; set; }
    public Guid WriteId { get; set; }
    public string Checksum { get; set; } = null!;
    public DateTime ProcessedAt { get; set; }
    // Null for historical orders: their original decision cannot be reconstructed safely.
    public bool? RejectedAsStale { get; set; }
}
