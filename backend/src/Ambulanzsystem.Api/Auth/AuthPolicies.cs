using Microsoft.AspNetCore.Authorization;

namespace Ambulanzsystem.Api.Auth;

public static class AuthPolicies
{
    public const string AdminOnly = nameof(AdminOnly);
    public const string LeitstelleOrAdmin = nameof(LeitstelleOrAdmin);
    public const string AuthenticatedUser = nameof(AuthenticatedUser);
    public const string TriageWrite = nameof(TriageWrite);

    public static void AddAmbulanzsystemPolicies(this AuthorizationOptions options)
    {
        options.AddPolicy(AdminOnly, p => p.RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin));

        options.AddPolicy(LeitstelleOrAdmin, p =>
            p.RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle));

        options.AddPolicy(AuthenticatedUser, p =>
            p.RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle, TokenTypes.User));

        options.AddPolicy(TriageWrite, p =>
            p.RequireClaim(TokenTypes.ClaimType, TokenTypes.Admin, TokenTypes.Leitstelle, TokenTypes.User, TokenTypes.Qr));
    }
}
