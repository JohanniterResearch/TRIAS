using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Services;

public static class ProtokollWriteChecksum
{
    public static string Compute(UpsertProtokollRequest request)
    {
        // Hash the bound order before merge/clamping. Omit null object properties at every
        // depth, but preserve array elements and their order. Stored form data is unchanged.
        var checksumOptions = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
            WriteSorted(writer, JsonSerializer.SerializeToElement(request, checksumOptions));
        return Convert.ToHexString(SHA256.HashData(buffer.ToArray()));
    }

    private static void WriteSorted(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
                if (property.Value.ValueKind == JsonValueKind.Null) continue;
                writer.WritePropertyName(property.Name);
                WriteSorted(writer, property.Value);
            }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            writer.WriteStartArray();
            foreach (var item in value.EnumerateArray()) WriteSorted(writer, item);
            writer.WriteEndArray();
        }
        else value.WriteTo(writer);
    }
}
