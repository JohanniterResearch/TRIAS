namespace Ambulanzsystem.Api.Domain;

// Original result of one scoped order, committed with its business effects and audit.
public class PatientWriteReceipt
{
    public string Scope { get; set; } = null!;
    public string Target { get; set; } = null!;
    public Guid WriteId { get; set; }
    public string Checksum { get; set; } = null!;
    public int? PatientId { get; set; }
    public string ResultJson { get; set; } = null!;
    public DateTime ProcessedAt { get; set; }
}
