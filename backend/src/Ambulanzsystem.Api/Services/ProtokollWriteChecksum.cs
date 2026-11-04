using System.Security.Cryptography;
using System.Text.Json;
using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Services;

public static class ProtokollWriteChecksum
{
    public static string Compute(UpsertProtokollRequest request)
    {
        // Hash the bound order before merge/clamping. Keep explicit form nulls and array order;
        // only JSON object property order is irrelevant. Optional DTO nulls remain included.
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
            WriteSorted(writer, JsonSerializer.SerializeToElement(request));
        return Convert.ToHexString(SHA256.HashData(buffer.ToArray()));
    }

    private static void WriteSorted(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
            {
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
