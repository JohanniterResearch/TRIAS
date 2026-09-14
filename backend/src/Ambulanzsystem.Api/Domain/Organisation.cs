namespace Ambulanzsystem.Api.Domain;

public class Organisation : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = null!;
}
