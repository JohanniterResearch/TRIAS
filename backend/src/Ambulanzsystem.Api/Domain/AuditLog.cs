namespace Ambulanzsystem.Api.Domain;

// Append-only (D7). No update/delete code path exists anywhere in the app on purpose —
// don't add EF tracking that would allow one.
public class AuditLog
{
    public long Id { get; set; }
    public DateTime Timestamp { get; set; }

    public int? ActorId { get; set; }
    public string ActorRole { get; set; } = null!; // admin|leitstelle|user|qr

    public string Action { get; set; } = null!; // read|write|export|login|revoke
    public string EntityType { get; set; } = null!;
    public int? EntityId { get; set; }
    public int? PatientId { get; set; }

    public string? ChangedFieldsJson { get; set; } // jsonb array of field names
    public string? BeforeJson { get; set; } // jsonb: field name -> value before write
    public string? AfterJson { get; set; } // jsonb: field name -> value after write
}
