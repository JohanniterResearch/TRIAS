namespace Ambulanzsystem.Api.Domain;

public class RefreshToken : AuditableEntity
{
    public int Id { get; set; }

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    // SHA-256 hash of the raw token only. The raw token is returned to the client once and never
    // persisted (recreation spec deviation #1 — this fixes a known hardening gap).
    public string TokenHash { get; set; } = null!;

    public DateTime ExpiresAt { get; set; }
    public bool IsRevoked { get; set; }

    // Set only when the token was exchanged for a new one (not on logout/admin revocation), so a
    // later second use of it can be recognised as theft.
    public DateTime? RotatedAt { get; set; }
}
