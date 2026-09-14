using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Ambulanzsystem.Api.Domain;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Ambulanzsystem.Api.Auth;

public record IssuedToken(string Token, DateTime ExpiresAt);

public class TokenService(IOptions<JwtOptions> options)
{
    private readonly JwtOptions _options = options.Value;

    // Admin/Leitstelle/User tokens carry a security_stamp claim, re-checked against the DB on
    // every request (SecurityStampValidation) so a password change or forced logout invalidates
    // every live token instantly, without a blocklist.
    public IssuedToken IssueUserToken(User user, bool devPasswordChangeBypass = false)
    {
        var type = user.Role switch
        {
            Role.Admin => TokenTypes.Admin,
            Role.Leitstelle => TokenTypes.Leitstelle,
            Role.Responder => TokenTypes.User,
            _ => throw new ArgumentOutOfRangeException(nameof(user)),
        };

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(TokenTypes.ClaimType, type),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(TokenTypes.SecurityStampClaimType, user.SecurityStamp),
        };

        if (devPasswordChangeBypass)
        {
            claims.Add(new Claim(TokenTypes.DevPasswordChangeBypassClaimType, "true"));
        }

        if (user.EventSceneId is int sceneId)
        {
            claims.Add(new Claim(TokenTypes.SceneIdClaimType, sceneId.ToString()));
        }

        var expires = DateTime.UtcNow.AddMinutes(_options.AccessTokenLifetimeMinutes);
        return new IssuedToken(WriteToken(claims, expires), expires);
    }

    // No security_stamp claim (QR sessions are inherently short-lived and re-scanned, not
    // revalidated per-request — recreation spec §2.4). Lifetime is capped by the QR code's own
    // ExpiresAt so a near-expiry code can't mint a long-lived session.
    public IssuedToken IssueQrToken(int qrCodeLoginId, int eventSceneId, DateTime qrExpiresAt)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, qrCodeLoginId.ToString()),
            new(TokenTypes.ClaimType, TokenTypes.Qr),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new(TokenTypes.SceneIdClaimType, eventSceneId.ToString()),
        };

        var natural = DateTime.UtcNow.AddMinutes(_options.QrTokenLifetimeMinutes);
        var expires = natural < qrExpiresAt ? natural : qrExpiresAt;
        return new IssuedToken(WriteToken(claims, expires), expires);
    }

    private string WriteToken(IEnumerable<Claim> claims, DateTime expires)
    {
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.Secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: JwtOptions.Issuer,
            audience: JwtOptions.Audience,
            claims: claims,
            expires: expires,
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
