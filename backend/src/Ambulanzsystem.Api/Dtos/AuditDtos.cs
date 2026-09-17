using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record AuditEntryResponse(
    long Id,
    DateTime Timestamp,
    int? ActorId,
    string ActorRole,
    string Action,
    string EntityType,
    int? EntityId,
    int? PatientId,
    string[]? ChangedFields,
    string? Before,
    string? After,
    string? Reason)
{
    public static AuditEntryResponse From(AuditLog a) => new(
        a.Id, a.Timestamp, a.ActorId, a.ActorRole, a.Action, a.EntityType, a.EntityId, a.PatientId,
        a.ChangedFieldsJson is null ? null : System.Text.Json.JsonSerializer.Deserialize<string[]>(a.ChangedFieldsJson),
        a.BeforeJson, a.AfterJson, a.Reason);
}

public record AuditQueryResponse(int Total, List<AuditEntryResponse> Entries);
