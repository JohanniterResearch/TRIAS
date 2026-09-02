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
    [HttpGet]
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    [AuditRead("user")]
    public async Task<IActionResult> List()
    {
        var users = await db.Users.AsNoTracking().OrderBy(u => u.Username).ToListAsync();
        return Ok(users.Select(UserResponse.From));
    }

    [HttpPost]
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IActionResult> Create(CreateUserRequest request)
    {
        if (request.Role is null)
        {
            return BadRequest(new ErrorResponse("role is required."));
        }

        if (!PasswordPolicy.IsValid(request.Password))
        {
            return BadRequest(new ErrorResponse(PasswordPolicy.ErrorMessage));
        }

        if (await db.Users.AnyAsync(u => u.Username == request.Username))
        {
            return Conflict(new ErrorResponse("Username already exists."));
        }

        if (request.AccountType == AccountType.Event && request.EventSceneId is null)
        {
            return BadRequest(new ErrorResponse("eventSceneId is required when accountType is event."));
        }

        if (request.EventSceneId is int eventSceneId && !await SceneAccess.IsTopLevelEventAsync(db, eventSceneId))
        {
            return BadRequest(new ErrorResponse("eventSceneId must reference an existing top-level event."));
        }

        var user = new User
        {
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = request.Role.Value,
            AccountType = request.AccountType,
            EventSceneId = request.EventSceneId,
            // Forced change applies only to newly created Admin/Leitstelle accounts — Responder
            // accounts have no self-service change UI yet (see DataSeeder), forcing it here would
            // strand them.
            RequiresPasswordChange = request.Role is Role.Admin or Role.Leitstelle,
        };

        db.Users.Add(user);

        // Id is unassigned until save; entityId stays null rather than a second save (D7
        // requirement 4). Password hash is never logged.
        audit.LogFieldWrite(User, "user", null, null, "created", null, user.Username);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(Create), new { id = user.Id }, UserResponse.From(user));
    }

    [HttpPost("change-password")]
    [Authorize(Policy = AuthPolicies.AuthenticatedUser)]
    [AllowPendingPasswordChange]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest request)
    {
        if (!PasswordPolicy.IsValid(request.NewPassword))
        {
            return BadRequest(new ErrorResponse(PasswordPolicy.ErrorMessage));
        }

        var subjectId = User.SubjectId();
        if (subjectId is null) return Unauthorized(new ErrorResponse("Invalid current credentials."));

        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = await RowLocks.UserAsync(db, subjectId.Value);

        // The same user-row lock is acquired by refresh rotation. It serializes password changes
        // with creation of successor refresh tokens so no token can appear after the revoke-all
        // query and survive with the new security stamp.
        if (user is null || user.Username != request.Username ||
            !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
        {
            return Unauthorized(new ErrorResponse("Invalid current credentials."));
        }

        var passwordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);

        user.PasswordHash = passwordHash;
        user.RequiresPasswordChange = false;
        // Regenerating the stamp invalidates every outstanding access token for this user
        // (recreation spec §2.4) — a real security event, not just a local state change.
        user.SecurityStamp = Guid.NewGuid().ToString();
        // Never log the actual hash — just that a change happened.
        audit.LogFieldWrite(User, "user", user.Id, null, "password", null, "changed");
        await refreshTokens.RevokeAllForUserAsync(user.Id);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();

        return NoContent();
    }

    [HttpPost("{id:int}/revoke")]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    public async Task<IActionResult> Revoke(int id)
    {
        var user = await db.Users.FindAsync(id);
        if (user is null) return NotFound();

        var actorType = User.TokenType();
        if (user.Id == User.SubjectId()) return Forbid();

        if (actorType == TokenTypes.Leitstelle)
        {
            if (user.Role != Role.Responder || user.AccountType != AccountType.Event || user.EventSceneId is not int eventSceneId)
            {
                return Forbid();
            }

            if (!await SceneAccess.IsTopLevelEventAsync(db, eventSceneId) ||
                !await SceneAccess.CanAdministerAsync(User, db, eventSceneId))
            {
                return Forbid();
            }
        }
        return await RevokeUserAsync(
            user,
            User.FindFirst(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)?.Value);
    }

    [HttpPost("self-cancel")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [AllowPendingPasswordChange]
    public async Task<IActionResult> SelfCancel()
    {
        var type = User.FindFirst(TokenTypes.ClaimType)?.Value;
        if (type == TokenTypes.Qr)
        {
            if (User.SubjectId() is int qrLoginId)
            {
                var code = await db.QrCodeLogins.FindAsync(qrLoginId);
                if (code is not null && code.RevokedAt is null)
                {
                    code.RevokedAt = DateTime.UtcNow;
                }

                // Same SaveChangesAsync as the RevokedAt write above: the row mutation and its
                // audit entry commit as one transaction, or neither does.
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

        return await RevokeUserAsync(user, "self");
    }

    private async Task<IActionResult> RevokeUserAsync(User user, string? revokedBy)
    {
        async Task<IActionResult> SaveAsync()
        {
            user.RevokedAt = DateTime.UtcNow;
            user.RevokedBy = revokedBy;
            audit.LogRevoke(User, null, "unknown", "user", user.Id);
            await db.SaveChangesAsync();
            return NoContent();
        }

        if (user.Role != Role.Admin || user.RevokedAt is not null) return await SaveAsync();

        await using var transaction = await db.Database.BeginTransactionAsync();
        var activeAdmins = await db.Users
            .FromSqlInterpolated($"SELECT * FROM users WHERE role = {Role.Admin.ToString()} AND revoked_at IS NULL ORDER BY id FOR UPDATE")
            .ToListAsync();

        if (activeAdmins.Count <= 1)
        {
            await transaction.RollbackAsync();
            return Conflict(new ErrorResponse("The final active Admin cannot be revoked."));
        }

        var result = await SaveAsync();
        await transaction.CommitAsync();
        return result;
    }
}
