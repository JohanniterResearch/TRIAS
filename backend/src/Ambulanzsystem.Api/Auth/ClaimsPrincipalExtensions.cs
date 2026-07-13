using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Ambulanzsystem.Api.Auth;

public static class ClaimsPrincipalExtensions
{
    public static string? TokenType(this ClaimsPrincipal user) =>
        user.FindFirst(TokenTypes.ClaimType)?.Value;

    public static int? SubjectId(this ClaimsPrincipal user)
    {
        var claim = user.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
        return int.TryParse(claim, out var id) ? id : null;
    }

    // Present for qr sessions (always) and event-scoped user accounts (User.EventSceneId set).
    // Absent for admin/leitstelle/permanent-responder sessions, which are not event-scoped.
    public static int? EventSceneId(this ClaimsPrincipal user)
    {
        var claim = user.FindFirst(TokenTypes.SceneIdClaimType)?.Value;
        return int.TryParse(claim, out var id) ? id : null;
    }
}
