namespace Ambulanzsystem.Api.Domain;

// ponytail: created_at/updated_at is the only "audit" every table needs by default;
// the real AuditLog trail (D7) is a separate, explicit table, not this base class.
public abstract class AuditableEntity
{
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
