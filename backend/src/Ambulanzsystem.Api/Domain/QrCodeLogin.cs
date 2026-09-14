namespace Ambulanzsystem.Api.Domain;

public class QrCodeLogin : AuditableEntity
{
    public int Id { get; set; }

    // Random token embedded in the printed QR code. Anonymous — no identity encoded.
    public string QrToken { get; set; } = null!;

    // Top-level scene (event) this code grants access to (D6) — the whole subtree, not one sub-site.
    public int EventSceneId { get; set; }
    public OperationScene EventScene { get; set; } = null!;

    public DateTime? FirstLogin { get; set; }

    // Null until first login; then FirstLogin + ExpiresInHours. Adjustable per-code by Admin/Leitstelle.
    public DateTime? ExpiresAt { get; set; }
    public double ExpiresInHours { get; set; } = 12;

    public DateTime? RevokedAt { get; set; }
}
