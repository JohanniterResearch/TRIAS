using System.Text.Json.Nodes;

namespace Ambulanzsystem.Api.Data;

// Loads contract/schemas/ambulanzprotokoll-page1-default.json (linked into the build output) —
// the single source of truth for the empty form shape, shared with the frontend's own default
// template. Mirrors the BodyRegions loading pattern.
public static class AmbulanzprotokollDefaults
{
    private static readonly Lazy<string> _json = new(LoadJson);

    public static string DefaultFormStateJson => _json.Value;

    public static JsonObject FreshTemplate() => (JsonNode.Parse(_json.Value) as JsonObject)!;

    private static string LoadJson()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Contract", "ambulanzprotokoll-page1-default.json");
        return File.ReadAllText(path);
    }
}
