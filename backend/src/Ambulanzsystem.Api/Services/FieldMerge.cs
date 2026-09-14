using System.Text.Json;

namespace Ambulanzsystem.Api.Services;

// Backs Patient.FieldTimestampsJson — see the comment on that property for the LWW rule.
public class FieldMerge
{
    private readonly Dictionary<string, DateTime> _timestamps;

    private FieldMerge(Dictionary<string, DateTime> timestamps) => _timestamps = timestamps;

    public static FieldMerge Load(string json) =>
        new(JsonSerializer.Deserialize<Dictionary<string, DateTime>>(json) ?? []);

    public string Save() => JsonSerializer.Serialize(_timestamps);

    // Returns true (and records the new timestamp) if this write should be applied — i.e. its
    // effective timestamp is not older than the last recorded write to this exact field.
    public bool TryApply(string field, DateTime? clientUpdatedAt, DateTime now)
    {
        var candidate = clientUpdatedAt ?? now;

        if (_timestamps.TryGetValue(field, out var existing) && existing > candidate)
        {
            return false; // a newer write already landed for this field — stale sync, skip it.
        }

        _timestamps[field] = candidate;
        return true;
    }
}
