using System.Text.Json;
using Json.Schema;

namespace Ambulanzsystem.Api.Services;

public static class AmbulanzprotokollSchemaValidator
{
    public const string CanonicalSchemaReference = "ambulanzprotokoll-page1.schema.json";

    private static readonly Lazy<JsonSchema> Schema = new(LoadSchema);

    public static bool TryValidatePartial(JsonElement formState, out string? error)
    {
        if (formState.ValueKind != JsonValueKind.Object)
        {
            error = "formState must be a JSON object.";
            return false;
        }

        return TryValidate(formState, out error);
    }

    public static bool TryValidateMerged(string formStateJson, out string? error)
    {
        try
        {
            using var document = JsonDocument.Parse(formStateJson);
            return TryValidate(document.RootElement, out error);
        }
        catch (JsonException)
        {
            error = "formState must be valid JSON.";
            return false;
        }
    }

    private static bool TryValidate(JsonElement formState, out string? error)
    {
        var valid = Schema.Value.Evaluate(formState, new EvaluationOptions()).IsValid;
        error = valid ? null : "formState must conform to ambulanzprotokoll-page1.schema.json.";
        return valid;
    }

    private static JsonSchema LoadSchema()
    {
        Dialect.Default = Dialect.Draft202012;
        var path = Path.Combine(AppContext.BaseDirectory, "Contract", "ambulanzprotokoll-page1.schema.json");
        return JsonSchema.FromText(File.ReadAllText(path));
    }
}
