namespace Ambulanzsystem.Api.Domain;

public class QrCodePatient : AuditableEntity
{
    public int Id { get; set; }

    // Random token only — no patient/event metadata encoded (FR-QR-08).
    public string QrToken { get; set; } = null!;

    // Null until first scan. A patient has exactly one bound code at a time; reassignment (B4)
    // unbinds this and binds a fresh unbound code instead of mutating the token in place.
    public int? PatientId { get; set; }
    public Patient? Patient { get; set; }

    public int? UserId { get; set; }
    public User? User { get; set; }

    // Scene this code was last scanned into. Patient.OperationSceneId is the current authoritative link.
    public int? OperationSceneId { get; set; }
    public OperationScene? OperationScene { get; set; }
}
