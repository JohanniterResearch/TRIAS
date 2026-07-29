using System.Text.Json.Nodes;

namespace Ambulanzsystem.Api.Services;

// Leaf-level diff of two JSON object trees with the same shape (D7 requirement 3: protocol audit
// entries record changed leaf paths, e.g. "vitals.pulse", not a generic status field). Mirrors
// FormStateMerge's dotted-path convention and its "arrays are a leaf, never diffed element by
// element" rule.
public static class JsonDiff
{
    public static Dictionary<string, (object? Before, object? After)> Leaves(string beforeJson, string afterJson)
    {
        var before = JsonNode.Parse(beforeJson) as JsonObject ?? [];
        var after = JsonNode.Parse(afterJson) as JsonObject ?? [];
        var diffs = new Dictionary<string, (object?, object?)>();
        Walk(before, after, "", diffs);
        return diffs;
    }

    private static void Walk(JsonObject before, JsonObject after, string prefix, Dictionary<string, (object?, object?)> diffs)
    {
        var keys = before.Select(kv => kv.Key).Union(after.Select(kv => kv.Key));
        foreach (var key in keys)
        {
            var path = prefix.Length == 0 ? key : $"{prefix}.{key}";
            var b = before[key];
            var a = after[key];

            if (b is JsonObject or null && a is JsonObject or null && (b is JsonObject || a is JsonObject))
            {
                Walk(b as JsonObject ?? [], a as JsonObject ?? [], path, diffs);
                continue;
            }

            // ponytail: string-compare instead of JsonNode.DeepEquals — cheap, and equivalent for
            // the finite scalar/array leaves this tree can contain.
            if (b?.ToJsonString() != a?.ToJsonString())
            {
                diffs[path] = (b?.DeepClone(), a?.DeepClone());
            }
        }
    }
}
