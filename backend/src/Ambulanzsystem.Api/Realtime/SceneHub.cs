using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Realtime;

// contract/schemas/realtime-messages.md. Best-effort dashboard refresh (master-plan realtime
// default) — DB writes are the source of truth; JoinScene's snapshot is the reconnect recovery
// path, so there is no missed-message replay to implement.
[Authorize(Policy = AuthPolicies.TriageWrite)]
public class SceneHub(AppDbContext db, AuditService audit, RealtimePatientMapper patientMapper,
    SessionValidator sessions, SceneSubscriptions subscriptions) : Hub
{
    public static string GroupName(int sceneId) => $"scene:{sceneId}";

    public async Task JoinScene(int sceneId)
    {
        if (await sessions.ValidateAsync(Context.User!) != SessionValidity.Valid)
        {
            subscriptions.Remove(Context.ConnectionId);
            throw new HubException("Session is no longer valid.");
        }

        if (!await SceneAccess.CanAccessAsync(Context.User!, db, sceneId))
        {
            subscriptions.Remove(Context.ConnectionId, sceneId);
            throw new HubException("Not authorized for this scene.");
        }

        var patients = await db.Patients
            .Include(p => p.QrCodePatient)
            .Where(p => p.OperationSceneId == sceneId)
            .ToListAsync();
        var teams = await db.Teams.Where(t => t.OperationSceneId == sceneId).ToListAsync();

        audit.LogRead(Context.User!, "scene_snapshot", sceneId);
        await db.SaveChangesAsync();

        // Do not subscribe the connection until the mandatory read audit is durable. If audit
        // persistence fails, this invocation fails closed and the caller cannot receive later
        // group broadcasts without retrying a fully audited join.
        subscriptions.Add(Context.ConnectionId, Context.User!, sceneId);

        var snapshot = new SceneSnapshotMessage(
            "1", DateTime.UtcNow, sceneId,
            patients.Select(PatientResponse.From).Select(patientMapper.Map).ToList(),
            teams.Select(TeamResponse.From).ToList());

        await Clients.Caller.SendAsync("SceneSnapshot", snapshot);
    }

    public Task LeaveScene(int sceneId)
    {
        subscriptions.Remove(Context.ConnectionId, sceneId);
        return Task.CompletedTask;
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        subscriptions.Remove(Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }
}
