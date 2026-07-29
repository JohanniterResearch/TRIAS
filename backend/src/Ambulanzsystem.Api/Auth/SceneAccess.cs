using System.Security.Claims;
using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Auth;

// Single-scene version of the visibility rule in OperationScenesController.List — factored out
// so the SignalR hub's JoinScene check can't silently drift from the REST endpoint's rule.
public static class SceneAccess
{
    public static async Task<bool> CanAccessAsync(ClaimsPrincipal user, AppDbContext db, int sceneId)
    {
        var type = user.TokenType();
        var eventSceneId = user.EventSceneId();

        // Admin is always global. Leitstelle is global only when unscoped (no EventSceneId claim);
        // a scoped Leitstelle falls through to the same event/sub-site check as responders/QR.
        if (type is TokenTypes.Admin || (type == TokenTypes.Leitstelle && eventSceneId is null)) return true;

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
