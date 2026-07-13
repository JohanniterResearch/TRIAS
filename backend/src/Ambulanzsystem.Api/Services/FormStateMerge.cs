using System.Text.Json.Nodes;
using Ambulanzsystem.Api.Data;

namespace Ambulanzsystem.Api.Services;

// Deep field-level merge for the Ambulanzprotokoll formState tree (NFR-SAFE-08/09), the nested
// counterpart to Patient's flat FieldMerge. Two rules, applied at every leaf (a leaf is a scalar,
// null, or array — arrays are never diffed element-by-element, there's no stable identity to
// merge repeating rows on):
//
//  1. An empty incoming leaf (null / "" / []) NEVER overwrites a non-empty existing leaf, full
//     stop, regardless of timestamps. The client always PUTs a complete form snapshot, so there
//     is no way to tell "the user just cleared this field" apart from "this device's local draft
//     never had this field filled in" — and losing recorded patient data is worse than a stale
//     value lingering until someone enters a real replacement. (If an explicit "clear this field"
//     action is ever needed, it should be its own endpoint, not inferred from an empty snapshot.)
//  2. Otherwise, last-write-wins per leaf path, gated by FieldMerge using the request's single
//     clientUpdatedAt for every leaf it touches (the contract doesn't carry per-leaf timestamps).
public static class FormStateMerge
{
    public static string Apply(string existingJson, JsonNode incomingRoot, FieldMerge merge, DateTime? clientUpdatedAt, DateTime now)
    {
        var existing = (JsonNode.Parse(existingJson) as JsonObject) ?? [];
        MergeObject(existing, incomingRoot as JsonObject ?? [], "", merge, clientUpdatedAt, now);
        return existing.ToJsonString();
    }

    // Reconstructs the full form shape for reads: default template with every path present in
    // `existingJson` overlaid on top, unconditionally (existing is always authoritative once set).
    public static string WithDefaults(string existingJson)
    {
        var result = AmbulanzprotokollDefaults.FreshTemplate();
        var existing = (JsonNode.Parse(existingJson) as JsonObject) ?? [];
        OverlayObject(result, existing);
        return result.ToJsonString();
    }

    private static void MergeObject(JsonObject existing, JsonObject incoming, string pathPrefix, FieldMerge merge, DateTime? clientUpdatedAt, DateTime now)
    {
        foreach (var (key, incomingValue) in incoming)
        {
            var path = pathPrefix.Length == 0 ? key : $"{pathPrefix}.{key}";

            if (incomingValue is JsonObject incomingObj)
            {
                if (existing[key] is not JsonObject existingObj)
                {
                    existingObj = [];
                    existing[key] = existingObj;
                }
                MergeObject(existingObj, incomingObj, path, merge, clientUpdatedAt, now);
                continue;
            }

            if (IsEmpty(incomingValue) && !IsEmpty(existing[key]))
            {
                continue; // rule 1
            }

            if (!merge.TryApply(path, clientUpdatedAt, now))
            {
                continue; // rule 2: stale write for this exact leaf
            }

            existing[key] = incomingValue?.DeepClone();
        }
    }

    private static void OverlayObject(JsonObject target, JsonObject overlay)
    {
        foreach (var (key, overlayValue) in overlay)
        {
            if (overlayValue is JsonObject overlayObj && target[key] is JsonObject targetObj)
            {
                OverlayObject(targetObj, overlayObj);
            }
            else
            {
                target[key] = overlayValue?.DeepClone();
            }
        }
    }

    private static bool IsEmpty(JsonNode? node) => node switch
    {
        null => true,
        JsonArray arr => arr.Count == 0,
        JsonValue v when v.TryGetValue<string>(out var s) => string.IsNullOrWhiteSpace(s),
        _ => false, // numbers and booleans are never "empty" (false/0 are meaningful values)
    };
}
