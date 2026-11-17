using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Services;

public static class ProtokollWriteChecksum
{
    public static string Compute(UpsertProtokollRequest request) => Compute(request, omitNullObjectProperties: true);

    // Read compatibility only: first compare today's checksum, then exactly reproduce the
    // pre-9d261c1 algorithm. Never use the historical checksum for new receipts or rewrite one.
    public static bool MatchesStored(UpsertProtokollRequest request, string currentChecksum, string storedChecksum) =>
        storedChecksum == currentChecksum || storedChecksum == Compute(request, omitNullObjectProperties: false);

    private static string Compute(UpsertProtokollRequest request, bool omitNullObjectProperties)
    {
        // Hash the bound order before merge/clamping. Only the current algorithm omits null
        // object properties at every depth; both preserve array elements and their order.
        var checksumOptions = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = omitNullObjectProperties ? JsonIgnoreCondition.WhenWritingNull : JsonIgnoreCondition.Never,
        };
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
            WriteSorted(writer, JsonSerializer.SerializeToElement(request, checksumOptions), omitNullObjectProperties);
        return Convert.ToHexString(SHA256.HashData(buffer.ToArray()));
    }

    private static void WriteSorted(Utf8JsonWriter writer, JsonElement value, bool omitNullObjectProperties)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
                if (omitNullObjectProperties && property.Value.ValueKind == JsonValueKind.Null) continue;
                writer.WritePropertyName(property.Name);
                WriteSorted(writer, property.Value, omitNullObjectProperties);
            }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray()) WriteSorted(writer, item, omitNullObjectProperties);
            writer.WriteEndArray();
        }
        else value.WriteTo(writer);
    }
}
