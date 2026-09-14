namespace Ambulanzsystem.Api.Domain;

public class User : AuditableEntity
{
    public int Id { get; set; }
    public string Username { get; set; } = null!;
    public string PasswordHash { get; set; } = null!;
    public Role Role { get; set; }
    public AccountType AccountType { get; set; } = AccountType.Permanent;

    // Scene subtree (event) this account is scoped to when AccountType == Event.
    public int? EventSceneId { get; set; }
    public OperationScene? EventScene { get; set; }

    public bool RequiresPasswordChange { get; set; }

    // Regenerated on password change to instantly invalidate all outstanding access tokens.
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString();

    public DateTime? FirstLoginTime { get; set; }
    public DateTime? LastLoginTime { get; set; }

    // Set by Admin, Leitstelle, or self-cancel. Blocks new actions/reads; does not force client logout.
    public DateTime? RevokedAt { get; set; }
    public string? RevokedBy { get; set; }

    public List<RefreshToken> RefreshTokens { get; set; } = [];
}
