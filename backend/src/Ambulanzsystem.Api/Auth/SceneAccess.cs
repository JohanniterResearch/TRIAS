using System.Security.Claims;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Auth;

// Single-scene version of the visibility rule in OperationScenesController.List — factored out
// so the SignalR hub's JoinScene check can't silently drift from the REST endpoint's rule.
public static class SceneAccess
{
    public static bool IsGlobalAdministrator(ClaimsPrincipal user) =>
        user.TokenType() is TokenTypes.Admin ||
        (user.TokenType() == TokenTypes.Leitstelle && user.EventSceneId() is null);

    public static bool CanAdminister(ClaimsPrincipal user, OperationScene scene)
    {
        if (IsGlobalAdministrator(user)) return true;

        return user.TokenType() == TokenTypes.Leitstelle &&
            user.EventSceneId() is int eventSceneId &&
            (scene.Id == eventSceneId || scene.ParentSceneId == eventSceneId);
    }

    public static async Task<bool> CanAdministerAsync(ClaimsPrincipal user, AppDbContext db, int sceneId)
    {
        var scene = await db.OperationScenes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sceneId);
        return scene is not null && CanAdminister(user, scene);
    }

    public static Task<bool> IsTopLevelEventAsync(AppDbContext db, int sceneId) =>
        db.OperationScenes.AnyAsync(scene => scene.Id == sceneId && scene.ParentSceneId == null);

    public static async Task<bool> CanAccessAsync(ClaimsPrincipal user, AppDbContext db, int sceneId)
    {
        var type = user.TokenType();
        var eventSceneId = user.EventSceneId();

        // Admin is always global. Leitstelle is global only when unscoped (no EventSceneId claim);
        // a scoped Leitstelle falls through to the same event/sub-site check as responders/QR.
        if (IsGlobalAdministrator(user)) return true;

        var scene = await db.OperationScenes.FirstOrDefaultAsync(s => s.Id == sceneId);
        if (scene is null || !scene.Active) return false;

        var now = DateTime.UtcNow;
        var withinWindow = (scene.AccessWindowStart is null || scene.AccessWindowStart <= now)
            && (scene.AccessWindowEnd is null || scene.AccessWindowEnd >= now);
        if (!withinWindow) return false;

        if (eventSceneId is int scoped)
        {
            return scene.Id == scoped || scene.ParentSceneId == scoped;
        }

        return true; // permanent responder, not event-scoped
    }
}
