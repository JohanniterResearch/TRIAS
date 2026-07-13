using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record CreateOrganisationRequest(string Name);

public record OrganisationResponse(int Id, string Name, DateTime CreatedAt, DateTime UpdatedAt)
{
    public static OrganisationResponse From(Organisation o) => new(o.Id, o.Name, o.CreatedAt, o.UpdatedAt);
}
