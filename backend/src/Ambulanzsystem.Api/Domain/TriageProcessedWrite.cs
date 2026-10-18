namespace Ambulanzsystem.Api.Domain;

public class TriageProcessedWrite
{
    public int PatientId { get; set; }
    public Guid WriteId { get; set; }
    public string Checksum { get; set; } = null!;
}
