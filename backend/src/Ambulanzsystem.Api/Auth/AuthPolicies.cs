using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Controllers;

namespace Ambulanzsystem.Api.Auth;

public static class AuthPolicies
{
    public const string AdminOnly = nameof(AdminOnly);
    public const string LeitstelleOrAdmin = nameof(LeitstelleOrAdmin);
    public const string AuthenticatedUser = nameof(AuthenticatedUser);
    public const string TriageWrite = nameof(TriageWrite);

    public static void AddAmbulanzsystemPolicies(this AuthorizationOptions options)
    {
        options.AddPolicy(AdminOnly, p => p
            .RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin)
            .RequireAssertion(PasswordChangeGateAllows));

        options.AddPolicy(LeitstelleOrAdmin, p => p
            .RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle)
            .RequireAssertion(PasswordChangeGateAllows));

        options.AddPolicy(AuthenticatedUser, p => p
            .RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle, TokenTypes.User)
            .RequireAssertion(PasswordChangeGateAllows));

        options.AddPolicy(TriageWrite, p => p
            .RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle, TokenTypes.User, TokenTypes.Qr)
            .RequireAssertion(PasswordChangeGateAllows));

        // Several controllers use a bare [Authorize] (no Policy=) which routes through
        // DefaultPolicy, not one of the named policies above — the gate has to cover that path too
        // or it's trivially bypassed. Rebuilt from the existing default so RequireAuthenticatedUser
        // is preserved, not replaced.
        options.DefaultPolicy = new AuthorizationPolicyBuilder(options.DefaultPolicy)
            .RequireAssertion(PasswordChangeGateAllows)
            .Build();
    }

    // Denies only when the live-checked requires_password_change claim (set per-request by
    // SecurityStampValidation, never trusted from the JWT itself) is present and the target action
    // isn't explicitly marked as reachable while a change is pending (see
    // AllowPendingPasswordChangeAttribute): change-password, logout, self-cancel, validate-token.
    private static bool PasswordChangeGateAllows(AuthorizationHandlerContext ctx)
    {
        if (!ctx.User.HasClaim(TokenTypes.RequiresPasswordChangeClaimType, "true"))
        {
            return true;
        }

        var endpoint = ctx.Resource as Endpoint ?? (ctx.Resource as HttpContext)?.GetEndpoint();
        var descriptor = endpoint?.Metadata.GetMetadata<ControllerActionDescriptor>();
        var exempt = descriptor?.MethodInfo
            .GetCustomAttributes(typeof(AllowPendingPasswordChangeAttribute), inherit: false)
            .Length > 0;

        return exempt;
    }
}
