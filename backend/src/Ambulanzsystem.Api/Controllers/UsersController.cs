using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/users")]
[Authorize]
public class UsersController(AppDbContext db, RefreshTokenService refreshTokens, AuditService audit) : ControllerBase
{
    [HttpPost]
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IActionResult> Create(CreateUserRequest request)
    {
        if (request.Role is null)
        {
            return BadRequest(new ErrorResponse("role is required."));
        }

        if (await db.Users.AnyAsync(u => u.Username == request.Username))
        {
            return Conflict(new ErrorResponse("Username already exists."));
        }

        if (request.AccountType == AccountType.Event && request.EventSceneId is null)
        {
            return BadRequest(new ErrorResponse("eventSceneId is required when accountType is event."));
        }

        var user = new User
        {
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = request.Role.Value,
            AccountType = request.AccountType,
            EventSceneId = request.EventSceneId,
            RequiresPasswordChange = true,
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(Create), new { id = user.Id }, UserResponse.From(user));
    }

    [HttpPost("change-password")]
    [Authorize(Policy = AuthPolicies.AuthenticatedUser)]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == request.Username);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            return Unauthorized(new ErrorResponse("Invalid current credentials."));
        }

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        user.RequiresPasswordChange = false;
        // Regenerating the stamp invalidates every outstanding access token for this user
        // (recreation spec §2.4) — a real security event, not just a local state change.
        user.SecurityStamp = Guid.NewGuid().ToString();
        await db.SaveChangesAsync();

        await refreshTokens.RevokeAllForUserAsync(user.Id);

        return NoContent();
    }

    [HttpPost("{id:int}/revoke")]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    public async Task<IActionResult> Revoke(int id)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        user.RevokedAt = DateTime.UtcNow;
        user.RevokedBy = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        audit.LogRevoke(User, null, "unknown", "user", id);
        await db.SaveChangesAsync();

        return NoContent();
    }

    [HttpPost("self-cancel")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> SelfCancel()
    {
        var type = User.FindFirst(TokenTypes.ClaimType)?.Value;
        if (type == TokenTypes.Qr)
        {
            // QR sessions have no User row to revoke; ending access is purely client-side
            // (discard the token — recreation spec §2.4, QR sessions are short-lived by design).
            // Still audit-logged: the fact that the session self-cancelled is meaningful even
            // though there's no DB row to mutate.
            if (User.SubjectId() is int qrLoginId)
            {
                audit.LogRevoke(User, null, TokenTypes.Qr, "qr_code_login", qrLoginId);
                await db.SaveChangesAsync();
            }
            return NoContent();
        }

        var subClaim = User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value;
        if (subClaim is null || !int.TryParse(subClaim, out var userId))
        {
            return Unauthorized();
        }

        var user = await db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        user.RevokedAt = DateTime.UtcNow;
        user.RevokedBy = "self";
        audit.LogRevoke(User, null, "unknown", "user", userId);
        await db.SaveChangesAsync();

        return NoContent();
    }
}
