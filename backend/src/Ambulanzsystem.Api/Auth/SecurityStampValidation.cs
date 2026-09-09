using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Ambulanzsystem.Api.Auth;

public static class SecurityStampValidation
{
    public static async Task OnTokenValidated(TokenValidatedContext context)
    {
        var validator = context.HttpContext.RequestServices.GetRequiredService<SessionValidator>();
        var validity = await validator.ValidateAsync(context.Principal!);
        if (validity == SessionValidity.Invalid)
        {
            context.Fail("Session is no longer valid.");
            return;
        }

        // Recompute this live claim so the existing policy still permits only password recovery
        // endpoints until the change succeeds. A Development bypass is evaluated by the validator.
        var identity = context.Principal!.Identity as ClaimsIdentity;
        foreach (var claim in context.Principal.FindAll(TokenTypes.RequiresPasswordChangeClaimType).ToList())
            identity?.TryRemoveClaim(claim);
        if (validity == SessionValidity.PasswordChangeRequired)
            identity?.AddClaim(new Claim(TokenTypes.RequiresPasswordChangeClaimType, "true"));
    }
}
