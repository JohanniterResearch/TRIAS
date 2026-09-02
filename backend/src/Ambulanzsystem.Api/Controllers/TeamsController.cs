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
[Route("api/teams")]
[Authorize]
public class TeamsController(AppDbContext db, SceneNotifier notifier, AuditService audit) : ControllerBase
{
    private static readonly HashSet<string> ValidStatuses = ["free", "busy", "unavailable"];

    // Must match contract/openapi.yaml's additionalProperties: false for this endpoint exactly —
    // a typo here silently diverges the runtime from the schema-validated contract.
    private static readonly HashSet<string> KnownUpdateProperties =
        ["status", "assignedPatientId", "assignedLocation", "contactInfo"];

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

        if (!await SceneAccess.CanAccessAsync(User, db, request.OperationSceneId)) return Forbid();

        var team = new Team { OperationSceneId = request.OperationSceneId, Name = request.Name };
        db.Teams.Add(team);

        // Id is unassigned until save; entityId stays null rather than a second save (D7
        // requirement 4).
        audit.LogFieldWrite(User, "team", null, null, "created", null, team.Name);
        await db.SaveChangesAsync();

        notifier.TeamUpdated(team.OperationSceneId, TeamResponse.From(team));

        return CreatedAtAction(nameof(List), new { operationSceneId = team.OperationSceneId }, TeamResponse.From(team));
    }

    [HttpGet]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [AuditRead("team_list", AuditIdSource.Query, "operationSceneId")]
    public async Task<IActionResult> List([FromQuery] int operationSceneId)
    {
        if (!await SceneAccess.CanAccessAsync(User, db, operationSceneId)) return Forbid();

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
        if (!await SceneAccess.CanAccessAsync(User, db, team.OperationSceneId)) return Forbid();

        // Root shape and property names are validated before any field is read or mutated, so a
        // rejected request never leaves a partial change on `team` (nothing is saved yet either
        // way, but this also means the field loop below can assume a known, well-typed shape).
        if (body.ValueKind != JsonValueKind.Object)
        {
            return BadRequest(new ErrorResponse("Request body must be a JSON object."));
        }

        foreach (var property in body.EnumerateObject())
        {
            if (!KnownUpdateProperties.Contains(property.Name))
            {
                return BadRequest(new ErrorResponse($"Unknown property: {property.Name}."));
            }
        }

        var changes = new Dictionary<string, (object? Before, object? After)>();

        if (body.TryGetProperty("status", out var statusEl))
        {
            var beforeStatus = team.Status;
            if (statusEl.ValueKind == JsonValueKind.Null)
            {
                team.Status = null;
            }
            else if (statusEl.ValueKind == JsonValueKind.String)
            {
                var value = statusEl.GetString();
                if (value is null || !ValidStatuses.Contains(value))
                {
                    return BadRequest(new ErrorResponse("status must be one of free, busy, unavailable, or null."));
                }
                team.Status = value;
            }
            else
            {
                return BadRequest(new ErrorResponse("status must be one of free, busy, unavailable, or null."));
            }
            changes["status"] = (beforeStatus, team.Status);
        }

        if (body.TryGetProperty("assignedPatientId", out var patientEl))
        {
            var before = team.AssignedPatientId;
            if (patientEl.ValueKind == JsonValueKind.Null)
            {
                team.AssignedPatientId = null;
            }
            else if (patientEl.ValueKind == JsonValueKind.Number && patientEl.TryGetInt32(out var patientId))
            {
                if (!await db.Patients.AnyAsync(p =>
                        p.Id == patientId && p.OperationSceneId == team.OperationSceneId))
                {
                    return BadRequest(new ErrorResponse("assignedPatientId does not exist in the team's scene."));
                }
                team.AssignedPatientId = patientId;
            }
            else
            {
                return BadRequest(new ErrorResponse("assignedPatientId must be an integer or null."));
            }
            changes["assignedPatientId"] = (before, team.AssignedPatientId);
        }

        if (body.TryGetProperty("assignedLocation", out var locationEl))
        {
            if (!TryReadOptionalString(locationEl, "assignedLocation", out var value, out var error))
            {
                return BadRequest(error);
            }

            var before = team.AssignedLocation;
            team.AssignedLocation = value;
            changes["assignedLocation"] = (before, team.AssignedLocation);
        }

        if (body.TryGetProperty("contactInfo", out var contactEl))
        {
            if (!TryReadOptionalString(contactEl, "contactInfo", out var value, out var error))
            {
                return BadRequest(error);
            }

            var before = team.ContactInfo;
            team.ContactInfo = value;
            changes["contactInfo"] = (before, team.ContactInfo);
        }

        audit.LogFieldsWrite(User, "team", team.Id, team.AssignedPatientId, changes);
        await db.SaveChangesAsync();

        notifier.TeamUpdated(team.OperationSceneId, TeamResponse.From(team));

        return Ok(TeamResponse.From(team));
    }

    private static bool TryReadOptionalString(
        JsonElement element,
        string propertyName,
        out string? value,
        out ErrorResponse? error)
    {
        value = null;
        error = null;
        if (element.ValueKind == JsonValueKind.Null) return true;
        if (element.ValueKind != JsonValueKind.String)
        {
            error = new ErrorResponse($"{propertyName} must be a string or null.");
            return false;
        }

        value = element.GetString();
        if (value!.Length <= ExternalStringLimits.ShortText) return true;

        error = new ErrorResponse($"{propertyName} must not exceed {ExternalStringLimits.ShortText} characters.");
        return false;
    }
}
