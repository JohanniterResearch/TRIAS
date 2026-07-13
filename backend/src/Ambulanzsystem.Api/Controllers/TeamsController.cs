using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/teams")]
[Authorize]
public class TeamsController(AppDbContext db, SceneNotifier notifier) : ControllerBase
{
    private static readonly HashSet<string> ValidStatuses = ["free", "busy", "unavailable"];

    [HttpPost]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    public async Task<IActionResult> Create(CreateTeamRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new ErrorResponse("name is required."));
        }

        if (!await db.OperationScenes.AnyAsync(s => s.Id == request.OperationSceneId))
        {
            return BadRequest(new ErrorResponse("operationSceneId does not exist."));
        }

        var team = new Team { OperationSceneId = request.OperationSceneId, Name = request.Name };
        db.Teams.Add(team);
        await db.SaveChangesAsync();

        notifier.TeamUpdated(team.OperationSceneId, TeamResponse.From(team));

        return CreatedAtAction(nameof(List), new { operationSceneId = team.OperationSceneId }, TeamResponse.From(team));
    }

    [HttpGet]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> List([FromQuery] int operationSceneId)
    {
        var teams = await db.Teams
            .Where(t => t.OperationSceneId == operationSceneId)
            .OrderBy(t => t.Name)
            .ToListAsync();

        return Ok(teams.Select(TeamResponse.From));
    }

    // Every field is independently optional AND clearable (FR-TEAM-07): a key that is present
    // with value null clears that field; a key that is absent leaves it unchanged. Plain record
    // binding can't distinguish "absent" from "null", so this reads the raw JSON body instead.
    [HttpPut("{id:int}")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> Update(int id, [FromBody] JsonElement body)
    {
        var team = await db.Teams.FindAsync(id);
        if (team is null) return NotFound();

        if (body.TryGetProperty("status", out var statusEl))
        {
            if (statusEl.ValueKind == JsonValueKind.Null)
            {
                team.Status = null;
            }
            else
            {
                var value = statusEl.GetString();
                if (value is null || !ValidStatuses.Contains(value))
                {
                    return BadRequest(new ErrorResponse("status must be one of free, busy, unavailable, or null."));
                }
                team.Status = value;
            }
        }

        if (body.TryGetProperty("assignedPatientId", out var patientEl))
        {
            if (patientEl.ValueKind == JsonValueKind.Null)
            {
                team.AssignedPatientId = null;
            }
            else
            {
                var patientId = patientEl.GetInt32();
                if (!await db.Patients.AnyAsync(p => p.Id == patientId))
                {
                    return BadRequest(new ErrorResponse("assignedPatientId does not exist."));
                }
                team.AssignedPatientId = patientId;
            }
        }

        if (body.TryGetProperty("assignedLocation", out var locationEl))
        {
            team.AssignedLocation = locationEl.ValueKind == JsonValueKind.Null ? null : locationEl.GetString();
        }

        if (body.TryGetProperty("contactInfo", out var contactEl))
        {
            team.ContactInfo = contactEl.ValueKind == JsonValueKind.Null ? null : contactEl.GetString();
        }

        await db.SaveChangesAsync();

        notifier.TeamUpdated(team.OperationSceneId, TeamResponse.From(team));

        return Ok(TeamResponse.From(team));
    }
}
