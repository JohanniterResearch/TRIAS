using System.Text.Json;

namespace Ambulanzsystem.Api.Data;

// Loads contract/body-regions.json (linked into the build output, see the .csproj) so backend
// seeding and validation never drift from the frontend's canonical region list.
public static class BodyRegions
{
    private static readonly Lazy<IReadOnlyList<string>> _allKeys = new(LoadAllKeys);

    public static IReadOnlyList<string> AllKeys => _allKeys.Value;

    public static string DefaultBodyPartsJson()
    {
        var dict = AllKeys.ToDictionary(k => k, _ => 0);
        return JsonSerializer.Serialize(dict);
    }

    private static IReadOnlyList<string> LoadAllKeys()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Contract", "body-regions.json");
        using var stream = File.OpenRead(path);
        using var doc = JsonDocument.Parse(stream);
        var front = doc.RootElement.GetProperty("front").EnumerateArray().Select(x => x.GetString()!);
        var back = doc.RootElement.GetProperty("back").EnumerateArray().Select(x => x.GetString()!);
        return front.Concat(back).ToList();
    }
}
