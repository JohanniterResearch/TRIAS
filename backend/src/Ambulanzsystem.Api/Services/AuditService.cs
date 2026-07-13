using System.Security.Claims;
using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Services;

// D7. Reads are logged by AuditReadFilter (one row per request, not per row of data); writes,
// logins, and revocations are logged explicitly at their call sites via this service, since each
// carries different before/after semantics.
public class AuditService(AppDbContext db)
{
    // Does not call SaveChangesAsync — batched into the caller's own save so the entity write and
    // its audit row commit as one transaction.
    public void LogFieldWrite(ClaimsPrincipal actor, string entityType, int entityId, int? patientId, string field, object? before, object? after) =>
        LogEvent(actor.SubjectId(), actor.TokenType() ?? "unknown", "write", entityType, entityId, patientId, field, before, after);

    // Login/revoke happen before a ClaimsPrincipal exists on the request (the call that issues or
    // ends a session), so the actor is passed explicitly rather than read off `User`.
    public void LogLogin(int? actorId, string actorRole, string entityType, int? entityId) =>
        LogEvent(actorId, actorRole, "login", entityType, entityId, null, null, null, null);

    public void LogRevoke(ClaimsPrincipal? actor, int? actorId, string actorRole, string entityType, int entityId) =>
        LogEvent(actor?.SubjectId() ?? actorId, actor?.TokenType() ?? actorRole, "revoke", entityType, entityId, null, null, null, null);

    private void LogEvent(int? actorId, string actorRole, string action, string entityType, int? entityId, int? patientId, string? field, object? before, object? after)
    {
        db.AuditLogs.Add(new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            ActorId = actorId,
            ActorRole = actorRole,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            PatientId = patientId,
            ChangedFieldsJson = field is null ? null : JsonSerializer.Serialize(new[] { field }),
            BeforeJson = before is null ? null : JsonSerializer.Serialize(before),
            AfterJson = after is null ? null : JsonSerializer.Serialize(after),
        });
    }
}
