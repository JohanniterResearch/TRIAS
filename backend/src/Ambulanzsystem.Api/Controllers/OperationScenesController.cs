using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/operation-scenes")]
[Authorize]
public class OperationScenesController(AppDbContext db, AuditService audit) : ControllerBase
{
    [HttpPost]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    public async Task<IActionResult> CreateOrUpdate(CreateOrUpdateSceneRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new ErrorResponse("name is required."));
        }

        var isCreate = request.Id is null;
        OperationScene scene;

        if (isCreate)
        {
            scene = new OperationScene();
        }
        else
        {
            var existing = await db.OperationScenes.FindAsync(request.Id!.Value);
            if (existing is null) return NotFound();
            if (!SceneAccess.CanAdminister(User, existing)) return Forbid();
            scene = existing;
        }

        if (request.ParentSceneId is int parentId)
        {
            if (parentId == scene.Id)
            {
                return BadRequest(new ErrorResponse("A scene cannot be its own parent."));
            }

            var parent = await db.OperationScenes.FindAsync(parentId);
            if (parent is null)
            {
                return BadRequest(new ErrorResponse("parentSceneId does not exist."));
            }

            if (!SceneAccess.CanAdminister(User, parent)) return Forbid();

            // Only one level of nesting: the parent must itself be top-level.
            if (parent.ParentSceneId is not null)
            {
                return BadRequest(new ErrorResponse("parentSceneId must reference a top-level scene (only one level of sub-sites is supported)."));
            }

            // A scene that already has sub-sites cannot become a sub-site itself
            // (that would create two levels of nesting).
            if (!isCreate && await db.OperationScenes.AnyAsync(s => s.ParentSceneId == scene.Id))
            {
                return BadRequest(new ErrorResponse("This scene already has sub-sites and cannot become a sub-site itself."));
            }
        }

        if (!SceneAccess.IsGlobalAdministrator(User) &&
            (request.ParentSceneId is null && (isCreate || scene.ParentSceneId is not null)))
        {
            return Forbid();
        }

        if (request.OrganisationId is int orgId && !await db.Organisations.AnyAsync(o => o.Id == orgId))
        {
            return BadRequest(new ErrorResponse("organisationId does not exist."));
        }

        if (isCreate) db.OperationScenes.Add(scene);

        var newActive = request.Active ?? (isCreate ? true : scene.Active);
        var changes = new Dictionary<string, (object? Before, object? After)>();
        void Track(string field, object? before, object? after)
        {
            if (!Equals(before, after)) changes[field] = (before, after);
        }
        Track("name", scene.Name, request.Name);
        Track("description", scene.Description, request.Description);
        Track("organisationId", scene.OrganisationId, request.OrganisationId);
        Track("parentSceneId", scene.ParentSceneId, request.ParentSceneId);
        Track("accessWindowStart", scene.AccessWindowStart, request.AccessWindowStart);
        Track("accessWindowEnd", scene.AccessWindowEnd, request.AccessWindowEnd);
        Track("active", scene.Active, newActive);

        scene.Name = request.Name;
        scene.Description = request.Description;
        scene.OrganisationId = request.OrganisationId;
        scene.ParentSceneId = request.ParentSceneId;
        scene.AccessWindowStart = request.AccessWindowStart;
        scene.AccessWindowEnd = request.AccessWindowEnd;
        scene.Active = newActive;

        // Id is unassigned until save on create; entityId stays null rather than a second save
        // (D7 requirement 4: audit row and entity write commit in the same transaction).
        audit.LogFieldsWrite(User, "operation_scene", isCreate ? null : scene.Id, null, changes);

        await db.SaveChangesAsync();

        return Ok(OperationSceneResponse.From(scene));
    }

    [HttpGet]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [AuditRead("operation_scene_list")]
    public async Task<IActionResult> List()
    {
        var type = User.TokenType();
        var now = DateTime.UtcNow;
        var eventSceneId = User.EventSceneId();

        // Admin is always global; Leitstelle only when unscoped (mirrors SceneAccess.CanAccessAsync).
        if (type is TokenTypes.Admin || (type == TokenTypes.Leitstelle && eventSceneId is null))
        {
            var all = await db.OperationScenes.OrderByDescending(s => s.UpdatedAt).ToListAsync();
            return Ok(all.Select(OperationSceneResponse.From));
        }

        // Scoped Leitstelle, responder (permanent or event), or QR session.
        IQueryable<OperationScene> query = db.OperationScenes.Where(s => s.Active);

        query = eventSceneId is int sceneId
            ? query.Where(s => s.Id == sceneId || s.ParentSceneId == sceneId) // event subtree only
            : query; // permanent responder, not event-scoped: any active scene within its window

        query = query.Where(s =>
            (s.AccessWindowStart == null || s.AccessWindowStart <= now) &&
            (s.AccessWindowEnd == null || s.AccessWindowEnd >= now));

        var scenes = await query.OrderByDescending(s => s.UpdatedAt).ToListAsync();
        return Ok(scenes.Select(OperationSceneResponse.From));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Policy = AuthPolicies.AdminOnly)]
    public async Task<IActionResult> Delete(int id)
    {
        var scene = await db.OperationScenes.FindAsync(id);
        if (scene is null) return NotFound();

        if (await db.Patients.AnyAsync(p => p.OperationSceneId == id))
        {
            return Conflict(new ErrorResponse("Scene has linked patients; deactivate instead of deleting."));
        }

        if (await db.OperationScenes.AnyAsync(s => s.ParentSceneId == id))
        {
            return Conflict(new ErrorResponse("Scene has sub-sites; remove or reassign them first."));
        }

        if (await db.Users.AnyAsync(u => u.EventSceneId == id))
        {
            return Conflict(new ErrorResponse("Scene has assigned user accounts; deactivate instead of deleting."));
        }

        db.OperationScenes.Remove(scene);
        audit.LogFieldWrite(User, "operation_scene", id, null, "deleted", scene.Name, null);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException
            { SqlState: PostgresErrorCodes.ForeignKeyViolation, ConstraintName: "fk_users_operation_scenes_event_scene_id" })
        {
            // An account may have been assigned after the precheck; the FK preserves its scope.
            return Conflict(new ErrorResponse("Scene has assigned user accounts; deactivate instead of deleting."));
        }

        return NoContent();
    }
}
