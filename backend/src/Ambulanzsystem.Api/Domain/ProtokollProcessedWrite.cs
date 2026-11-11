namespace Ambulanzsystem.Api.Domain;

public class ProtokollProcessedWrite
{
    public int PatientId { get; set; }
    public Guid WriteId { get; set; }
    public string Checksum { get; set; } = null!;
    public DateTime ProcessedAt { get; set; }
}
