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
[Route("api/login-qr-codes")]
[Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
public class LoginQrCodesController(AppDbContext db, AuditService audit) : ControllerBase
{
    [HttpPost("generate")]
    public async Task<IActionResult> Generate(GenerateLoginQrCodesRequest request)
    {
        if (request.Number is < 1 or > 500)
        {
            return BadRequest(new ErrorResponse("number must be between 1 and 500."));
        }

        if (!await SceneAccess.IsTopLevelEventAsync(db, request.EventSceneId))
        {
            return BadRequest(new ErrorResponse("eventSceneId must reference an existing top-level event."));
        }

        if (!await SceneAccess.CanAdministerAsync(User, db, request.EventSceneId)) return Forbid();

        var codes = new List<QrCodeLogin>();
        for (var i = 0; i < request.Number; i++)
        {
            codes.Add(new QrCodeLogin
            {
                QrToken = QrTokenGenerator.Generate(),
                EventSceneId = request.EventSceneId,
                ExpiresInHours = request.ExpiresInHours ?? 12,
            });
        }

        db.QrCodeLogins.AddRange(codes);

        // A batch tied to one scene, not a single entity — entityId is the scene it was
        // generated for, same convention as the count-only qr_code_patient batch.
        audit.LogFieldWrite(User, "login_qr_code_batch", request.EventSceneId, null, "created", null, request.Number);
        await db.SaveChangesAsync();

        return Created(string.Empty, codes.Select(LoginQrCodeResponse.From));
    }

    [HttpGet]
    [AuditRead("login_qr_code_list")]
    public async Task<IActionResult> List([FromQuery] int? eventSceneId, [FromQuery] bool unusedOnly = false)
    {
        if (eventSceneId is int requestedEventSceneId)
        {
            if (!await SceneAccess.IsTopLevelEventAsync(db, requestedEventSceneId))
            {
                return BadRequest(new ErrorResponse("eventSceneId must reference an existing top-level event."));
            }

            if (!await SceneAccess.CanAdministerAsync(User, db, requestedEventSceneId)) return Forbid();
        }

        var query = db.QrCodeLogins.AsQueryable();
        if (User.TokenType() == TokenTypes.Leitstelle && User.EventSceneId() is int scopedEventSceneId)
        {
            query = query.Where(c => c.EventSceneId == scopedEventSceneId);
        }
        if (eventSceneId is not null) query = query.Where(c => c.EventSceneId == eventSceneId);
        if (unusedOnly) query = query.Where(c => c.FirstLogin == null && c.RevokedAt == null);

        var codes = await query.OrderByDescending(c => c.CreatedAt).ToListAsync();
        return Ok(codes.Select(LoginQrCodeResponse.From));
    }

    [HttpPost("{id:int}/revoke")]
    public async Task<IActionResult> Revoke(int id)
    {
        var code = await db.QrCodeLogins.FindAsync(id);
        if (code is null) return NotFound();
        if (!await SceneAccess.CanAdministerAsync(User, db, code.EventSceneId)) return Forbid();

        code.RevokedAt = DateTime.UtcNow;
        audit.LogRevoke(User, null, "unknown", "qr_code_login", id);
        await db.SaveChangesAsync();

        return NoContent();
    }
}
