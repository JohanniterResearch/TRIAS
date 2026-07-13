namespace Ambulanzsystem.Api.Domain;

public class Patient : AuditableEntity
{
    public int Id { get; set; }

    public bool? Atmung { get; set; }
    public bool? Blutung { get; set; }
    public bool? Radialispuls { get; set; }
    public bool? Transport { get; set; }
    public bool? Dringend { get; set; }
    public bool? Kontaminiert { get; set; }

    // rot|gelb|gruen|schwarz or null (D5: ASCII canonical). CHECK constraint enforced in DB (B1 config).
    public string? Triagefarbe { get; set; }

    public string? Name { get; set; }

    // Set for manually created patients; short, memorable, no patient-identifying content (FR-PAT-07).
    public string? HumanReadableId { get; set; }

    // Offline idempotency key (D3): replaying the same client-generated id must never duplicate a patient.
    public Guid? ClientGeneratedId { get; set; }

    public double? LongitudePatient { get; set; }
    public double? LatitudePatient { get; set; }
    public string? LocationSource { get; set; } // gps|manual
    public double? LocationAccuracyMeters { get; set; }
    public string? IndoorLocation { get; set; }
    public DateTime? LocationUpdatedAt { get; set; }

    // Per-field last-write-wins timestamps (NFR-SAFE-08/09): field name -> effective write time.
    // A write only applies to a field if its clientUpdatedAt (or now, if none given) is >= the
    // stored timestamp for that exact field — so a stale offline sync can never clobber a newer
    // value, and untouched fields are never affected by someone else's later write.
    public string FieldTimestampsJson { get; set; } = "{}";

    // Direct scene link (review finding #6) — not derived only via QrCodePatient, so manual patients
    // are scene-linked too.
    public int OperationSceneId { get; set; }
    public OperationScene OperationScene { get; set; } = null!;

    // The user/session that created or currently owns this patient's documentation.
    public int? UserIdUser { get; set; }
    public User? User { get; set; }

    public Body? Body { get; set; }
    public AmbulanzprotokollPage1? AmbulanzprotokollPage1 { get; set; }
    public QrCodePatient? QrCodePatient { get; set; }
}
