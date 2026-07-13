namespace Ambulanzsystem.Api.Auth;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    // Fixed per recreation spec §2.4 — only the secret is configurable.
    public const string Issuer = "PLS";
    public const string Audience = "PLS";

    public string Secret { get; set; } = null!;

    public int AccessTokenLifetimeMinutes { get; set; } = 60;
    public int RefreshTokenLifetimeDays { get; set; } = 30;

    // QR sessions are inherently short-lived; also capped by the QrCodeLogin's own ExpiresAt.
    public int QrTokenLifetimeMinutes { get; set; } = 480;
}
