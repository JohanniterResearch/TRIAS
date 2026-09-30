namespace Ambulanzsystem.Api.Auth;

public class JwtOptions
{
    public const string SectionName = "Jwt";

    // Fixed per recreation spec §2.4 — only the secret is configurable.
    public const string Issuer = "PLS";
    public const string Audience = "PLS";

    public string Secret { get; set; } = null!;

    // Short, because logout cannot recall an issued access token; the refresh flow renews it.
    public const int AccessTokenLifetimeMinutes = 15;
    public const int RefreshTokenLifetimeDays = 30;

    // QR sessions are inherently short-lived; also capped by the QrCodeLogin's own ExpiresAt.
    public const int QrTokenLifetimeMinutes = 480;
}
