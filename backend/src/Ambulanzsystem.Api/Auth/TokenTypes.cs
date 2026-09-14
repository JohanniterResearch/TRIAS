namespace Ambulanzsystem.Api.Auth;

// The JWT `type` claim value — four distinct values so a QR-scanner session can never be
// mistaken for an authenticated human user (recreation spec §2.4).
public static class TokenTypes
{
    public const string Admin = "admin";
    public const string Leitstelle = "leitstelle";
    public const string User = "user";
    public const string Qr = "qr";

    public const string ClaimType = "type";
    public const string SecurityStampClaimType = "security_stamp";
    public const string SceneIdClaimType = "scene_id";
    public const string DevPasswordChangeBypassClaimType = "dev_password_change_bypass";

    // Added to the principal (not the JWT itself — recomputed live on every request by
    // SecurityStampValidation) while a forced password change is pending.
    public const string RequiresPasswordChangeClaimType = "requires_password_change";
}
