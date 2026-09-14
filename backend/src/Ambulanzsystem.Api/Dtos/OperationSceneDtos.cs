using System.ComponentModel.DataAnnotations;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

// Active is nullable and preserve-if-omitted on update (same fix class as the B2 Role bug):
// a metadata-only edit that doesn't mention "active" must never silently reactivate a
// deactivated scene just because JSON-omitted bool binds to its type default.
public record CreateOrUpdateSceneRequest(
    int? Id,
    [MaxLength(ExternalStringLimits.Name)] string Name,
    [MaxLength(ExternalStringLimits.Description)] string? Description,
    int? OrganisationId,
    int? ParentSceneId,
    DateTime? AccessWindowStart,
    DateTime? AccessWindowEnd,
    bool? Active);

public record OperationSceneResponse(
    int Id,
    string Name,
    string? Description,
    int? OrganisationId,
    int? ParentSceneId,
    DateTime? AccessWindowStart,
    DateTime? AccessWindowEnd,
    bool Active,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static OperationSceneResponse From(OperationScene s) => new(
        s.Id, s.Name, s.Description, s.OrganisationId, s.ParentSceneId,
        s.AccessWindowStart, s.AccessWindowEnd, s.Active, s.CreatedAt, s.UpdatedAt);
}
