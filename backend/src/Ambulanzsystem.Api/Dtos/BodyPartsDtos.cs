namespace Ambulanzsystem.Api.Dtos;

public record BodyPartsResponse(int Idpatient, Dictionary<string, int> BodyParts, DateTime UpdatedAt);

public record ToggleBodyPartRequest(int Idpatient, string BodyPartId, bool IsClicked);
