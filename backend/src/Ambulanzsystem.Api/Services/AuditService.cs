using System.Security.Claims;
using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Services;

// D7. Reads are logged by AuditReadFilter (one row per request, not per row of data); writes,
// logins, exports, and revocations are logged explicitly at their call sites via this service,
// since each carries different before/after semantics.
public class AuditService(AppDbContext db)
{
    public void LogRead(ClaimsPrincipal actor, string entityType, int? entityId, int? patientId = null) =>
        LogEvent(actor.SubjectId(), actor.TokenType() ?? "unknown", "read", entityType, entityId, patientId, null, null, null);

    // Does not call SaveChangesAsync — batched into the caller's own save so the entity write and
    // its audit row commit as one transaction. BeforeJson/AfterJson are the raw scalar value
    // (kept as-is: existing consumers like PersonsController.TriageHistory pass these straight
    // through to clients and expect a bare scalar, not an object).
    public void LogFieldWrite(ClaimsPrincipal actor, string entityType, int? entityId, int? patientId, string field, object? before, object? after) =>
        LogEvent(actor.SubjectId(), actor.TokenType() ?? "unknown", "write", entityType, entityId, patientId, new[] { field }, before, after);

    // Multi-leaf writes (protocol formState diffs, team/scene multi-field PUTs): records every
    // changed leaf path and its before/after value in one row, e.g. {"vitals.pulse": 80} ->
    // {"vitals.pulse": 92}, rather than a single generic field name. Always logs — even zero
    // changes — so every authenticated write on these endpoints still produces exactly one audit
    // row (D7 requirement 2), matching the always-log behavior of the single-field writes above.
    public void LogFieldsWrite(ClaimsPrincipal actor, string entityType, int? entityId, int? patientId, IReadOnlyDictionary<string, (object? Before, object? After)> changes, string? reason = null)
    {
        var fields = changes.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray();
        var before = fields.ToDictionary(f => f, f => changes[f].Before);
        var after = fields.ToDictionary(f => f, f => changes[f].After);
        LogEvent(actor.SubjectId(), actor.TokenType() ?? "unknown", "write", entityType, entityId, patientId, fields, before, after, reason);
    }

    // FR-DOC-09/14: a real export event, distinct from the "write" that persists the export
    // archive row — queryable via /api/audit?action=export.
    public void LogExport(ClaimsPrincipal actor, string entityType, int? entityId, int? patientId, string detail) =>
        LogEvent(actor.SubjectId(), actor.TokenType() ?? "unknown", "export", entityType, entityId, patientId, new[] { "export" }, null, detail);

    // Login/revoke happen before a ClaimsPrincipal exists on the request (the call that issues or
    // ends a session), so the actor is passed explicitly rather than read off `User`.
    public void LogLogin(int? actorId, string actorRole, string entityType, int? entityId) =>
        LogEvent(actorId, actorRole, "login", entityType, entityId, null, null, null, null);

    public void LogRevoke(ClaimsPrincipal? actor, int? actorId, string actorRole, string entityType, int entityId) =>
        LogEvent(actor?.SubjectId() ?? actorId, actor?.TokenType() ?? actorRole, "revoke", entityType, entityId, null, null, null, null);

    private void LogEvent(int? actorId, string actorRole, string action, string entityType, int? entityId, int? patientId, string[]? fields, object? before, object? after, string? reason = null)
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
            ChangedFieldsJson = fields is null ? null : JsonSerializer.Serialize(fields),
            BeforeJson = before is null ? null : JsonSerializer.Serialize(before),
            AfterJson = after is null ? null : JsonSerializer.Serialize(after),
            Reason = reason,
        });
    }
}
