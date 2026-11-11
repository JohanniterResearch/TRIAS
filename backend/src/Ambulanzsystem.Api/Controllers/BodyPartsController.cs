using System.Data;
using System.Security.Cryptography;
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

        Guid? writeId = null;
        if (Request.Headers.TryGetValue("Idempotency-Key", out var key))
        {
            if (key.Count != 1 || key[0]?.Length != 36 ||
                !Guid.TryParseExact(key[0], "D", out var parsed) || parsed == Guid.Empty)
                return BadRequest(new ErrorResponse("Idempotency-Key must be a non-empty UUID in hyphenated format."));
            writeId = parsed;
        }

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var body = await RowLocks.BodyAsync(db, request.Idpatient);
        if (body is null) return NotFound();
        var patient = await db.Patients.SingleAsync(p => p.Id == request.Idpatient);
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var parts = JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!;
        if (writeId is Guid keyId)
        {
            var checksum = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
            var processed = await db.BodyPartProcessedWrites.FindAsync(request.Idpatient, keyId);
            if (processed is not null)
            {
                if (processed.Checksum != checksum)
                    return Conflict(new ErrorResponse("Idempotency-Key was already used for a different body-part order."));
                return Ok(new BodyPartsResponse(request.Idpatient, parts, body.UpdatedAt));
            }
            // Committed with the marker and audit; the body lock serializes parallel replays.
            db.BodyPartProcessedWrites.Add(new BodyPartProcessedWrite
            {
                PatientId = request.Idpatient, WriteId = keyId, Checksum = checksum,
            });
        }

        var before = parts.GetValueOrDefault(request.BodyPartId, 0);
        var after = request.IsClicked ? 1 : 0;
        parts[request.BodyPartId] = after;
        body.BodyPartsJson = JsonSerializer.Serialize(parts);

        audit.LogFieldWrite(User, "body", body.Id, request.Idpatient, request.BodyPartId, before, after);

        await db.SaveChangesAsync();
        await tx.CommitAsync();

        await notifier.PatientUpdatedAsync(patient, false, bodyParts: parts);

        return Ok(new BodyPartsResponse(request.Idpatient, parts, body.UpdatedAt));
    }
}
