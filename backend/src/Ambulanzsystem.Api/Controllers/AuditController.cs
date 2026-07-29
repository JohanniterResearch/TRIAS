using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/audit")]
[Authorize(Policy = AuthPolicies.AdminOnly)]
public class AuditController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    [AuditRead("audit_query")]
    public async Task<IActionResult> Query(
        [FromQuery] int? patientId,
        [FromQuery] string? action,
        [FromQuery] string? entityType,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 100)
    {
        pageSize = Math.Clamp(pageSize, 1, 500);
        page = Math.Max(page, 1);

        var query = db.AuditLogs.AsQueryable();
        if (patientId is not null) query = query.Where(a => a.PatientId == patientId);
        if (action is not null) query = query.Where(a => a.Action == action);
        if (entityType is not null) query = query.Where(a => a.EntityType == entityType);
        if (from is not null) query = query.Where(a => a.Timestamp >= from);
        if (to is not null) query = query.Where(a => a.Timestamp <= to);

        var total = await query.CountAsync();
        var entries = await query
            .OrderByDescending(a => a.Timestamp)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new AuditQueryResponse(total, entries.Select(AuditEntryResponse.From).ToList()));
    }
}
