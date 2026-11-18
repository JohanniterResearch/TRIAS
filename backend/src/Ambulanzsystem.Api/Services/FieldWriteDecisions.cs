using System.Text.Json;
using System.Text.Json.Nodes;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Services;

public record FieldDecision(string Field, string Outcome, string? ConflictReason);
public record FieldWriteDetail(string Field, object? StoredValue, object? RequestedValue, object? ResultValue,
    DateTime? StoredUpdatedAt, DateTime? RequestedUpdatedAt, DateTime? ResultUpdatedAt,
    Guid? WriteId, string Decision, string? Reason);

// Request-scoped collector. The caller persists decisions and audits in its state transaction.
public class FieldWriteDecisions(Guid? writeId)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public List<FieldDecision> Decisions { get; } = [];
    public List<FieldWriteDetail> Details { get; } = [];
    public string Save() => JsonSerializer.Serialize(Decisions, Json);

    // Derived form values (currently the GCS sum) are recomputed after the leaf merge.
    // Audit the actual resulting value, retaining the original requested value/decision.
    public void RefreshFormResults(string json)
    {
        var root = JsonNode.Parse(json);
        for (var index = 0; index < Details.Count; index++)
        {
            var detail = Details[index];
            var value = root;
            foreach (var key in detail.Field.Split('.')) value = (value as JsonObject)?[key];
            var equal = JsonNode.DeepEquals(JsonSerializer.SerializeToNode(detail.StoredValue, Json), value);
            Details[index] = detail with {
                ResultValue = value?.DeepClone(),
                Decision = detail.Decision == "rejected_older_edit" ? detail.Decision : !equal ? "value_changed"
                    : detail.ResultUpdatedAt != detail.StoredUpdatedAt ? "timestamp_only" : "unchanged"
            };
        }
    }

    public bool Apply(FieldMerge merge, string field, object? stored, object? requested,
        DateTime? clientTime, DateTime now)
    {
        var storedTime = merge.Timestamp(field);
        var applied = merge.TryApply(field, clientTime, now);
        var result = applied ? requested : stored;
        Decisions.Add(new(field, applied ? "applied" : "rejected", applied ? null : "older_edit"));
        var equal = JsonNode.DeepEquals(JsonSerializer.SerializeToNode(stored, Json), JsonSerializer.SerializeToNode(result, Json));
        Details.Add(new(field, stored, requested, result, storedTime, clientTime,
            applied ? (clientTime is null ? null : merge.Timestamp(field)) : storedTime, writeId,
            !applied ? "rejected_older_edit" : !equal ? "value_changed" : storedTime != merge.Timestamp(field) ? "timestamp_only" : "unchanged",
            applied ? "time_comparison_passed" : "newer_stored_edit"));
        return applied;
    }

    public static object Location(Patient p) => new { lat = p.LatitudePatient, lng = p.LongitudePatient,
        source = p.LocationSource, accuracyMeters = p.LocationAccuracyMeters, indoorLocation = p.IndoorLocation };

    public static IReadOnlyList<FieldWriteResult>? PatientResults(string? saved, Patient patient) =>
        Results(saved, field => field == "location" ? JsonSerializer.SerializeToElement(Location(patient), Json)
            : JsonSerializer.SerializeToElement(PatientResponse.From(patient), Json).GetProperty(field));

    public static IReadOnlyList<FieldWriteResult>? FormResults(string? saved, string currentJson) =>
        Results(saved, field => {
            var node = JsonNode.Parse(currentJson);
            foreach (var key in field.Split('.')) node = (node as JsonObject)?[key];
            return JsonSerializer.SerializeToElement(node, Json);
        });

    private static IReadOnlyList<FieldWriteResult>? Results(string? saved, Func<string, JsonElement> current) =>
        saved is null ? null : (JsonSerializer.Deserialize<List<FieldDecision>>(saved, Json) ?? [])
            .Select(d => new FieldWriteResult(d.Field, d.Outcome, d.ConflictReason, current(d.Field))).ToList();
}
