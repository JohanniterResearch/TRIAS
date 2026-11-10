using System.Text.Json.Serialization;

namespace Ambulanzsystem.Api.Dtos;

public record BodyPartsResponse(int Idpatient, Dictionary<string, int> BodyParts, DateTime UpdatedAt);

public record ToggleBodyPartRequest(int Idpatient, string BodyPartId, bool IsClicked,
    // Omit an absent time from the checksum to preserve pre-timestamp processed orders.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTime? ClientUpdatedAt = null);
