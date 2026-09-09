using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Auth;

public enum SessionValidity { Invalid, PasswordChangeRequired, Valid }

// Shared by HTTP authentication, hub joins, and every realtime delivery. The principal contains
// verified claims, never the bearer token; the database remains authoritative for session state.
public class SessionValidator(AppDbContext db, IHostEnvironment environment, IConfiguration configuration)
{
    public async Task<SessionValidity> ValidateAsync(ClaimsPrincipal principal)
    {
        if (!int.TryParse(principal.FindFirstValue(JwtRegisteredClaimNames.Sub), out var subjectId)
            || !long.TryParse(principal.FindFirstValue(JwtRegisteredClaimNames.Exp), out var expires)
            || expires <= DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            return SessionValidity.Invalid;

        if (principal.TokenType() == TokenTypes.Qr)
        {
            var code = await db.QrCodeLogins.AsNoTracking().FirstOrDefaultAsync(c => c.Id == subjectId);
            return code is not null && code.RevokedAt is null
                && (code.ExpiresAt is null || code.ExpiresAt > DateTime.UtcNow)
                && code.EventSceneId == principal.EventSceneId()
                ? SessionValidity.Valid : SessionValidity.Invalid;
        }

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == subjectId);
        if (user is null || user.RevokedAt is not null
            || user.SecurityStamp != principal.FindFirstValue(TokenTypes.SecurityStampClaimType)
            || (user.AccountType == AccountType.Event && user.EventSceneId is null)
            || user.EventSceneId != principal.EventSceneId())
            return SessionValidity.Invalid;

        var expectedType = user.Role switch
        {
            Role.Admin => TokenTypes.Admin,
            Role.Leitstelle => TokenTypes.Leitstelle,
            Role.Responder => TokenTypes.User,
            _ => null,
        };
        if (expectedType is null || principal.TokenType() != expectedType) return SessionValidity.Invalid;

        var bypass = principal.HasClaim(TokenTypes.DevPasswordChangeBypassClaimType, "true")
            && environment.IsDevelopment() && configuration.GetValue<bool>("Features:EnableDevLogin");
        return user.RequiresPasswordChange && !bypass
            ? SessionValidity.PasswordChangeRequired : SessionValidity.Valid;
    }
}
