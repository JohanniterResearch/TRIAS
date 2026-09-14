namespace Ambulanzsystem.Api.Domain;

public class Team : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = null!;

    public int OperationSceneId { get; set; }
    public OperationScene OperationScene { get; set; } = null!;

    // free|busy|unavailable|null — every coordination field is independently optional (FR-TEAM-07).
    public string? Status { get; set; }

    public int? AssignedPatientId { get; set; }
    public Patient? AssignedPatient { get; set; }

    public string? AssignedLocation { get; set; }
    public string? ContactInfo { get; set; }
}
