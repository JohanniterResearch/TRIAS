using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Auth;

// Instant revocation without a blocklist (recreation spec §2.4): on every request, re-check the
// underlying DB row live instead of trusting the JWT's own claims.
public static class SecurityStampValidation
{
    public static Task OnTokenValidated(TokenValidatedContext context)
    {
        var subClaim = context.Principal?.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        if (subClaim is null || !int.TryParse(subClaim, out var subjectId))
        {
            context.Fail("Missing or invalid subject claim.");
            return Task.CompletedTask;
        }

        var typeClaim = context.Principal?.FindFirst(TokenTypes.ClaimType)?.Value;
        if (typeClaim == TokenTypes.Qr)
        {
            // QR tokens carry the QrCodeLogin row's id as `sub`. Re-fetch it on every request so a
            // revoke, self-cancel, or natural expiry takes effect immediately, not only at the next
            // token issuance.
            return ValidateQrSessionAsync(context, subjectId);
        }

        var stampClaim = context.Principal?.FindFirst(TokenTypes.SecurityStampClaimType)?.Value;
        if (stampClaim is null)
        {
            context.Fail("Missing security stamp claim.");
            return Task.CompletedTask;
        }

        return ValidateUserAsync(context, subjectId, stampClaim);
    }

    private static async Task ValidateQrSessionAsync(TokenValidatedContext context, int qrCodeLoginId)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var code = await db.QrCodeLogins.AsNoTracking().FirstOrDefaultAsync(c => c.Id == qrCodeLoginId);

        var now = DateTime.UtcNow;
        if (code is null || code.RevokedAt is not null || (code.ExpiresAt is not null && code.ExpiresAt < now))
        {
            context.Fail("QR session is no longer valid (missing, revoked, self-cancelled, or expired).");
        }
    }

    private static async Task ValidateUserAsync(TokenValidatedContext context, int userId, string stampClaim)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);

        if (user is null || user.SecurityStamp != stampClaim || user.RevokedAt is not null)
        {
            context.Fail("Token is no longer valid (revoked or security stamp changed).");
            return;
        }

        if (user.RequiresPasswordChange && !DevPasswordChangeBypassAllowed(context))
        {
            // Live-checked claim, not baked into the JWT: it clears itself on the very next request
            // after the user completes the change, without needing a fresh token. AuthPolicies uses
            // it to deny normal API access while still allowing the handful of endpoints a user in
            // this state needs to get unstuck (change-password, logout, self-cancel, validate-token).
            (context.Principal!.Identity as ClaimsIdentity)?.AddClaim(
                new Claim(TokenTypes.RequiresPasswordChangeClaimType, "true"));
        }
    }

    private static bool DevPasswordChangeBypassAllowed(TokenValidatedContext context)
    {
        if (!context.Principal!.HasClaim(TokenTypes.DevPasswordChangeBypassClaimType, "true"))
        {
            return false;
        }

        var env = context.HttpContext.RequestServices.GetRequiredService<IHostEnvironment>();
        if (!env.IsDevelopment())
        {
            return false;
        }

        var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        return config.GetValue<bool>("Features:EnableDevLogin");
    }
}
