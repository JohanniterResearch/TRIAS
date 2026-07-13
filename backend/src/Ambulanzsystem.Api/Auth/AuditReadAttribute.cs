namespace Ambulanzsystem.Api.Auth;

// Declares that a GET action reads patient-bearing data and must be audit-logged (D7,
// NFR-SEC-08). idSource/idParam tell AuditReadFilter where to find the scope id — a route value
// for single-patient reads, a query string value for scene-scoped list reads. Read logging is
// one entry per REQUEST (endpoint + scope), never per row (backend-flow-claude.md B6).
[AttributeUsage(AttributeTargets.Method)]
public class AuditReadAttribute(string entityType, AuditIdSource idSource, string idParam) : Attribute
{
    public string EntityType { get; } = entityType;
    public AuditIdSource IdSource { get; } = idSource;
    public string IdParam { get; } = idParam;
}

public enum AuditIdSource
{
    Route,
    Query,
}
