using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/body-parts")]
[Authorize(Policy = AuthPolicies.TriageWrite)]
public class BodyPartsController(AppDbContext db, AuditService audit, SceneNotifier notifier) : ControllerBase
{
    [HttpGet]
    [AuditRead("patient", AuditIdSource.Query, "idpatient")]
    public async Task<IActionResult> Get([FromQuery] int idpatient)
    {
        var body = await db.Bodies.Include(b => b.Patient).FirstOrDefaultAsync(b => b.PatientId == idpatient);
        if (body is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, body.Patient.OperationSceneId)) return Forbid();

        var parts = JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!;
        return Ok(new BodyPartsResponse(idpatient, parts, body.UpdatedAt));
    }

    [HttpPut]
    public async Task<IActionResult> Toggle(ToggleBodyPartRequest request)
    {
        if (!BodyRegions.AllKeys.Contains(request.BodyPartId))
        {
            return BadRequest(new ErrorResponse("Unknown bodyPartId."));
        }

        var body = await db.Bodies.Include(b => b.Patient).FirstOrDefaultAsync(b => b.PatientId == request.Idpatient);
        if (body is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, body.Patient.OperationSceneId)) return Forbid();

        var parts = JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!;
        var before = parts.GetValueOrDefault(request.BodyPartId, 0);
        var after = request.IsClicked ? 1 : 0;
        parts[request.BodyPartId] = after;
        body.BodyPartsJson = JsonSerializer.Serialize(parts);

        audit.LogFieldWrite(User, "body", body.Id, request.Idpatient, request.BodyPartId, before, after);

        await db.SaveChangesAsync();

        var protokollStatus = await db.AmbulanzprotokollPage1s.Where(r => r.PatientId == request.Idpatient).Select(r => r.Status).FirstOrDefaultAsync();
        notifier.PatientUpdated(body.Patient.OperationSceneId, PatientResponse.From(body.Patient), parts, false, protokollStatus);

        return Ok(new BodyPartsResponse(request.Idpatient, parts, body.UpdatedAt));
    }
}
