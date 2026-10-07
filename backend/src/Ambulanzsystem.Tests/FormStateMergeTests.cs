using System.Text.Json.Nodes;
using Ambulanzsystem.Api.Services;
using Xunit;

namespace Ambulanzsystem.Tests;

public class FormStateMergeTests
{
    private static string Name(string json) => JsonNode.Parse(json)!["patient"]!["name"]!.GetValue<string>();

    private static JsonNode NameUpdate(string name) => new JsonObject { ["patient"] = new JsonObject { ["name"] = name } };

    [Fact]
    public void FutureDeviceClock_IsClampedSoLaterNormalEditsStillApply()
    {
        var now = new DateTime(2026, 10, 5, 12, 0, 0, DateTimeKind.Utc);
        var merge = FieldMerge.Load("{}");
        var form = FormStateMerge.Apply("{}", NameUpdate("fast clock"), merge, now.AddHours(1), now);

        // Reload the persisted timestamps, as the next request would.
        merge = FieldMerge.Load(merge.Save());
        form = FormStateMerge.Apply(form, NameUpdate("normal clock"), merge, null, now.AddMinutes(1));
        Assert.Equal("normal clock", Name(form));

        form = FormStateMerge.Apply(form, NameUpdate("stale"), merge, now.AddHours(-1), now.AddMinutes(2));
        Assert.Equal("normal clock", Name(form));
    }
}
