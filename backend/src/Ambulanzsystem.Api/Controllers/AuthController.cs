using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Config;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api")]
public class AuthController(
    AppDbContext db,
    TokenService tokens,
    RefreshTokenService refreshTokens,
    AuditService audit,
    MetricsService metrics,
    IConfiguration config,
    IHostEnvironment env) : ControllerBase
{
    [HttpPost("qr-login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.LoginPolicy)]
    public async Task<IActionResult> QrLogin(QrLoginRequest request)
    {
        var code = await db.QrCodeLogins.FirstOrDefaultAsync(c => c.QrToken == request.qr_code);
        if (code is null || code.RevokedAt is not null)
        {
            metrics.IncrementAuthFailures();
            return Unauthorized(new ErrorResponse("Invalid or revoked QR code."));
        }

        var now = DateTime.UtcNow;
        if (code.FirstLogin is null)
        {
            code.FirstLogin = now;
            code.ExpiresAt = now.AddHours(code.ExpiresInHours);
            await db.SaveChangesAsync();
        }
        else if (code.ExpiresAt is not null && code.ExpiresAt < now)
        {
            metrics.IncrementAuthFailures();
            return Unauthorized(new ErrorResponse("QR code access has expired."));
        }

        var issued = tokens.IssueQrToken(code.Id, code.EventSceneId, code.ExpiresAt!.Value);
        audit.LogLogin(code.Id, TokenTypes.Qr, "qr_code_login", code.Id);
        await db.SaveChangesAsync();

        return Ok(new QrLoginResponse("ok", issued.Token, code.EventSceneId));
    }

    [HttpPost("user-login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.LoginPolicy)]
    public Task<IActionResult> UserLogin(CredentialsRequest request) =>
        LoginPrivileged(request, allowedRoles: [Role.Responder], asAdminResponse: false);

    [HttpPost("admin-login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.LoginPolicy)]
    public Task<IActionResult> AdminLogin(CredentialsRequest request) =>
        LoginPrivileged(request, allowedRoles: [Role.Admin, Role.Leitstelle], asAdminResponse: true);

    private async Task<IActionResult> LoginPrivileged(CredentialsRequest request, Role[] allowedRoles, bool asAdminResponse)
    {
        var userId = await db.Users.AsNoTracking().Where(u => u.Username == request.Username)
            .Select(u => (int?)u.Id).SingleOrDefaultAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = userId is int id ? await RowLocks.UserAsync(db, id) : null;

        if (user is null || user.RevokedAt is not null || !allowedRoles.Contains(user.Role)
            || (user.AccountType == AccountType.Event && user.EventSceneId is null)
            || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            metrics.IncrementAuthFailures();
            return Unauthorized(new ErrorResponse("Invalid username or password."));
        }

        TouchLoginTimestamps(user);

        var issued = tokens.IssueUserToken(user);
        var refresh = await refreshTokens.IssueAsync(user.Id);
        audit.LogLogin(user.Id, RoleClaim(user.Role), "user", user.Id);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        if (asAdminResponse)
        {
            var role = user.Role == Role.Admin ? TokenTypes.Admin : TokenTypes.Leitstelle;
            return Ok(new AdminLoginResponse("ok", issued.Token, refresh.RawToken, user.RequiresPasswordChange, role, user.EventSceneId));
        }

        return Ok(new UserLoginResponse("ok", issued.Token, refresh.RawToken));
    }

    private static string RoleClaim(Role role) => role switch
    {
        Role.Admin => TokenTypes.Admin,
        Role.Leitstelle => TokenTypes.Leitstelle,
        _ => TokenTypes.User,
    };

    [HttpPost("refresh-token")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.RefreshPolicy)]
    public async Task<IActionResult> Refresh(RefreshTokenRequest request)
    {
        var rotated = await refreshTokens.RotateAsync(request.RefreshToken);
        if (rotated is null)
        {
            metrics.IncrementAuthFailures();
            return Unauthorized(new ErrorResponse("Invalid, expired, or revoked refresh token."));
        }

        var (user, newRefresh) = rotated.Value;
        var issued = tokens.IssueUserToken(user);
        return Ok(new RefreshTokenResponse(issued.Token, newRefresh.RawToken));
    }

    [HttpPost("logout")]
    [Authorize(Policy = AuthPolicies.AuthenticatedUser)]
    [AllowPendingPasswordChange]
    public async Task<IActionResult> Logout(RefreshTokenRequest request)
    {
        if (!await refreshTokens.RevokeAsync(request.RefreshToken))
        {
            return BadRequest(new ErrorResponse("Invalid refresh token."));
        }

        return NoContent();
    }

    [HttpPost("validate-token")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [AllowPendingPasswordChange]
    public IActionResult ValidateToken()
    {
        var role = User.FindFirst(TokenTypes.ClaimType)?.Value ?? "unknown";
        return Ok(new ValidateTokenResponse(true, role));
    }

    [HttpPost("dev-login")]
    [AllowAnonymous]
    [EnableRateLimiting(RateLimitPolicies.LoginPolicy)]
    public async Task<IActionResult> DevLogin(DevLoginRequest request)
    {
        if (!env.IsDevelopment() || !config.GetValue<bool>("Features:EnableDevLogin"))
        {
            return NotFound();
        }

        if (request.role is not ("admin" or "user"))
        {
            return BadRequest(new ErrorResponse("role must be admin or user."));
        }

        var wantedRole = request.role == "admin" ? Role.Admin : Role.Responder;
        var user = await db.Users.Where(u => u.Role == wantedRole && u.RevokedAt == null
                && (u.AccountType != AccountType.Event || u.EventSceneId != null))
            .OrderBy(u => u.Id)
            .FirstOrDefaultAsync();

        if (user is null)
        {
            return NotFound(new ErrorResponse("No seeded dev user for that role."));
        }

        TouchLoginTimestamps(user);

        var issued = tokens.IssueUserToken(user, devPasswordChangeBypass: true);
        audit.LogLogin(user.Id, RoleClaim(user.Role), "user", user.Id);
        await db.SaveChangesAsync();

        return Ok(new DevLoginResponse("ok", issued.Token, user.Username, false));
    }

    private static void TouchLoginTimestamps(User user)
    {
        var now = DateTime.UtcNow;
        user.FirstLoginTime ??= now;
        user.LastLoginTime = now;
    }
}
