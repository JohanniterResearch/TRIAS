namespace Ambulanzsystem.Api.Auth;

// Declares that a GET action reads patient-bearing or otherwise auditable data and must be
// audit-logged (D7, NFR-SEC-08). idSource/idParam tell AuditReadFilter where to find the scope id
// — a route value for single-patient reads, a query string value for scene-scoped list reads, or
// None for reads with no single natural id (e.g. an admin list/snapshot endpoint). Read logging is
// one entry per request scope, never per row.
[AttributeUsage(AttributeTargets.Method)]
public class AuditReadAttribute(string entityType, AuditIdSource idSource = AuditIdSource.None, string idParam = "") : Attribute
{
    public string EntityType { get; } = entityType;
    public AuditIdSource IdSource { get; } = idSource;
    public string IdParam { get; } = idParam;
}

public enum AuditIdSource
{
    Route,
    Query,
    None,
}
