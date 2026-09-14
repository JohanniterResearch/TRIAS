namespace Ambulanzsystem.Api.Domain;

public class OperationScene : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = null!;
    public string? Description { get; set; }

    public int? OrganisationId { get; set; }
    public Organisation? Organisation { get; set; }

    // D6: null = this scene IS the event (top-level); non-null = sub-site of that event.
    // Only one level of nesting is enforced at the application layer (B3).
    public int? ParentSceneId { get; set; }
    public OperationScene? ParentScene { get; set; }
    public List<OperationScene> SubSites { get; set; } = [];

    public DateTime? AccessWindowStart { get; set; }
    public DateTime? AccessWindowEnd { get; set; }
    public bool Active { get; set; } = true;

    public List<Patient> Patients { get; set; } = [];
    public List<Team> Teams { get; set; } = [];
}
