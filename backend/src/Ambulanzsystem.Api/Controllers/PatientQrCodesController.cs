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
[Route("api/patient-qr-codes")]
[Authorize]
public class PatientQrCodesController(AppDbContext db, AuditService audit) : ControllerBase
{
    [HttpPost("generate")]
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IActionResult> Generate(GeneratePatientQrCodesRequest request)
    {
        if (request.Number is < 1 or > 1000)
        {
            return BadRequest(new ErrorResponse("number must be between 1 and 1000."));
        }

        var codes = Enumerable.Range(0, request.Number)
            .Select(_ => new QrCodePatient { QrToken = QrTokenGenerator.Generate() })
            .ToList();

        db.QrCodePatients.AddRange(codes);

        // A batch, not a single entity — no natural entityId, same reasoning as the login-qr-code
        // batch generator below.
        audit.LogFieldWrite(User, "qr_code_patient_batch", null, null, "created", null, request.Number);
        await db.SaveChangesAsync();

        return Created(string.Empty, codes.Select(c => c.QrToken));
    }

    [HttpGet("unused")]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    [AuditRead("qr_code_patient_list")]
    public async Task<IActionResult> Unused()
    {
        var tokens = await db.QrCodePatients
            .Where(c => c.PatientId == null)
            .OrderBy(c => c.CreatedAt)
            .Select(c => c.QrToken)
            .ToListAsync();

        return Ok(tokens);
    }
}
