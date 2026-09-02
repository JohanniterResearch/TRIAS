using System.ComponentModel.DataAnnotations;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record CreateTeamRequest(
    int OperationSceneId,
    [MaxLength(ExternalStringLimits.Name)] string Name);

public record TeamResponse(
    int Id,
    int OperationSceneId,
    string Name,
    string? Status,
    int? AssignedPatientId,
    string? AssignedLocation,
    string? ContactInfo,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static TeamResponse From(Team t) => new(
        t.Id, t.OperationSceneId, t.Name, t.Status, t.AssignedPatientId,
        t.AssignedLocation, t.ContactInfo, t.CreatedAt, t.UpdatedAt);
}
