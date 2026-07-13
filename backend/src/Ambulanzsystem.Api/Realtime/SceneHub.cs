using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Realtime;

// contract/schemas/realtime-messages.md. Best-effort dashboard refresh (master-plan realtime
// default) — DB writes are the source of truth; JoinScene's snapshot is the reconnect recovery
// path, so there is no missed-message replay to implement.
[Authorize(Policy = AuthPolicies.TriageWrite)]
public class SceneHub(AppDbContext db) : Hub
{
    public static string GroupName(int sceneId) => $"scene:{sceneId}";

    public async Task JoinScene(int sceneId)
    {
        if (!await SceneAccess.CanAccessAsync(Context.User!, db, sceneId))
        {
            throw new HubException("Not authorized for this scene.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(sceneId));

        var patients = await db.Patients
            .Include(p => p.QrCodePatient)
            .Where(p => p.OperationSceneId == sceneId)
            .ToListAsync();
        var teams = await db.Teams.Where(t => t.OperationSceneId == sceneId).ToListAsync();

        var snapshot = new SceneSnapshotMessage(
            "1", DateTime.UtcNow, sceneId,
            patients.Select(PatientResponse.From).ToList(),
            teams.Select(TeamResponse.From).ToList());

        await Clients.Caller.SendAsync("SceneSnapshot", snapshot);
    }

    public async Task LeaveScene(int sceneId) =>
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(sceneId));
}
