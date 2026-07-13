using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Auth;

// Instant revocation without a blocklist (recreation spec §2.4): on every request bearing a
// security_stamp claim (i.e. every admin/leitstelle/user token — qr tokens never carry one),
// re-fetch the user and reject if the stamp no longer matches or the account was revoked.
public static class SecurityStampValidation
{
    public static Task OnTokenValidated(TokenValidatedContext context)
    {
        var stampClaim = context.Principal?.FindFirst(TokenTypes.SecurityStampClaimType)?.Value;
        if (stampClaim is null)
        {
            return Task.CompletedTask; // qr token — nothing to revalidate.
        }

        var subClaim = context.Principal?.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        if (subClaim is null || !int.TryParse(subClaim, out var userId))
        {
            context.Fail("Missing or invalid subject claim.");
            return Task.CompletedTask;
        }

        return ValidateAsync(context, userId, stampClaim);
    }

    private static async Task ValidateAsync(TokenValidatedContext context, int userId, string stampClaim)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);

        if (user is null || user.SecurityStamp != stampClaim || user.RevokedAt is not null)
        {
            context.Fail("Token is no longer valid (revoked or security stamp changed).");
        }
    }
}
