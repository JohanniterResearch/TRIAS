using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Ambulanzsystem.Tests;

public class FieldConflictTests
{
    [Fact]
    public async Task ProtocolRejectedValues_KeepFalseZeroAndNull_AndUnknownRequestTimeStaysNull()
    {
        using var factory = new Factory();
        var (client, id) = await Setup(factory);
        var time = DateTime.UtcNow.AddMinutes(-5);
        await Send(client, id, "protocol", Guid.NewGuid(), new { status = "draft", formState = new {
            patient = new { geschlecht = (string?)null }, vitals = new { schmerz = 0, keine = false }
        }, clientUpdatedAt = time });
        var rejected = await Send(client, id, "protocol", Guid.NewGuid(), new { status = "draft", formState = new {
            patient = new { geschlecht = "m" }, vitals = new { schmerz = 4, keine = true }
        }, clientUpdatedAt = time.AddMinutes(-1) });
        var results = rejected.GetProperty("fieldResults").EnumerateArray().ToDictionary(r => r.GetProperty("field").GetString()!);
        Assert.All(results.Values, r => Assert.Equal("rejected", r.GetProperty("outcome").GetString()));
        Assert.Equal(JsonValueKind.Null, results["patient.geschlecht"].GetProperty("serverValue").ValueKind);
        Assert.Equal(0, results["vitals.schmerz"].GetProperty("serverValue").GetInt32());
        Assert.False(results["vitals.keine"].GetProperty("serverValue").GetBoolean());
        var key = Guid.NewGuid();
        await Send(client, id, "location", key, new { lat = 0, lng = 0 });
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var detail = (await db.AuditLogs.Where(a => a.PatientId == id && a.WriteDetailsJson != null).ToListAsync())
            .SelectMany(a => Details(a.WriteDetailsJson!)).Single(d => d.GetProperty("writeId").GetGuid() == key);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("storedUpdatedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("requestedUpdatedAt").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("resultUpdatedAt").ValueKind);
    }

    [Theory]
    [InlineData("triage", "transport")]
    [InlineData("location", "location")]
    [InlineData("protocol", "patient.vorname")]
    [InlineData("respiration", "atmung")]
    public async Task RejectedOrder_ReplaysOriginalDecisionWithCurrentValue_WithoutEffects(string kind, string field)
    {
        using var factory = new Factory();
        var (client, id) = await Setup(factory);
        var time = DateTime.UtcNow.AddMinutes(-10);
        await Send(client, id, kind, Guid.NewGuid(), Order(kind, 1, time.AddMinutes(2)));
        var key = Guid.NewGuid();
        var order = Order(kind, 0, time);
        var first = await Send(client, id, kind, key, order);
        var rejected = first.GetProperty("fieldResults").EnumerateArray().Single(r => r.GetProperty("field").GetString() == field);
        Assert.Equal("rejected", rejected.GetProperty("outcome").GetString());
        Assert.Equal("older_edit", rejected.GetProperty("conflictReason").GetString());
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var rows = await db.AuditLogs.AsNoTracking().Where(a => a.PatientId == id && a.WriteDetailsJson != null).ToListAsync();
        var details = rows.SelectMany(a => Details(a.WriteDetailsJson!)).ToList();
        var detail = details.Single(d => d.GetProperty("writeId").GetGuid() == key);
        Assert.Equal("rejected_older_edit", detail.GetProperty("decision").GetString());
        Assert.Equal(time, detail.GetProperty("requestedUpdatedAt").GetDateTime());
        Assert.Equal(time.AddMinutes(2), detail.GetProperty("storedUpdatedAt").GetDateTime());
        Assert.Equal(detail.GetProperty("storedValue").GetRawText(), detail.GetProperty("resultValue").GetRawText());
        Assert.NotEqual(detail.GetProperty("storedValue").GetRawText(), detail.GetProperty("requestedValue").GetRawText());
        Assert.All(rows, a => { Assert.NotNull(a.ActorId); Assert.Equal(id, a.PatientId); });

        await Send(client, id, kind, Guid.NewGuid(), Order(kind, 2, time.AddMinutes(3)));
        var counts = await Counts(db, id);
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        while (publisher.Reader.TryRead(out _)) { }
        // The first response can be lost: retry reads the durable original decision.
        var retry = await Send(client, id, kind, key, order);
        var replay = retry.GetProperty("fieldResults").EnumerateArray().Single(r => r.GetProperty("field").GetString() == field);
        Assert.Equal("rejected", replay.GetProperty("outcome").GetString());
        Assert.NotEqual(rejected.GetProperty("serverValue").GetRawText(), replay.GetProperty("serverValue").GetRawText());
        Assert.Equal(await Counts(db, id), counts);
        Assert.False(publisher.Reader.TryRead(out _));
        using var conflict = await Request(client, id, kind, key, Order(kind, 3, time));
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal(await Counts(db, id), counts);
        // Pre-upgrade receipts are readable but carry no invented historical decision.
        if (kind != "respiration")
        {
            var table = kind == "protocol" ? "protokoll" : kind;
            await db.Database.ExecuteSqlRawAsync("UPDATE " + table + "_processed_writes SET decisions_json = NULL WHERE patient_id = {0} AND write_id = {1}", id, key);
            var legacy = await Send(client, id, kind, key, order);
            Assert.Equal(JsonValueKind.Null, legacy.GetProperty("fieldResults").ValueKind);
        }
    }

    [Theory]
    [InlineData("triage")]
    [InlineData("protocol")]
    public async Task PartialOrder_ReportsEachOutcome_AndAuditsOverwriteWithoutCallingTimestampOnlyAnOverwrite(string kind)
    {
        using var factory = new Factory();
        var (client, id) = await Setup(factory);
        var time = DateTime.UtcNow.AddMinutes(-10);
        await Send(client, id, kind, Guid.NewGuid(), Order(kind, 1, time.AddMinutes(2)));
        var key = Guid.NewGuid();
        object partial = kind == "triage"
            ? new { transport = false, dringend = false, clientUpdatedAt = time }
            : new { status = "draft", formState = new { patient = new { vorname = "0", familienname = "Teil" } }, clientUpdatedAt = time };
        var response = await Send(client, id, kind, key, partial);
        var results = response.GetProperty("fieldResults").EnumerateArray().ToArray();
        Assert.Contains(results, r => r.GetProperty("outcome").GetString() == "rejected");
        Assert.Contains(results, r => r.GetProperty("outcome").GetString() == "applied");
        await Send(client, id, kind, Guid.NewGuid(), Order(kind, 2, time.AddMinutes(3)));
        await Send(client, id, kind, Guid.NewGuid(), Order(kind, 2, time.AddMinutes(4)));
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var details = (await db.AuditLogs.Where(a => a.PatientId == id && a.WriteDetailsJson != null).ToListAsync())
            .SelectMany(a => Details(a.WriteDetailsJson!)).ToArray();
        Assert.Contains(details, d => d.GetProperty("decision").GetString() == "timestamp_only");
        Assert.Contains(details, d => d.GetProperty("decision").GetString() == "value_changed" && d.GetProperty("storedUpdatedAt").ValueKind != JsonValueKind.Null);
        Assert.Contains(details, d => d.GetProperty("storedUpdatedAt").ValueKind == JsonValueKind.Null);
    }

    private static IEnumerable<JsonElement> Details(string json)
    {
        var root = JsonDocument.Parse(json).RootElement;
        return root.ValueKind == JsonValueKind.Array ? root.EnumerateArray().ToArray() : [root];
    }
    private static async Task<(int, int, int)> Counts(AppDbContext db, int id) =>
        (await db.AuditLogs.CountAsync(a => a.PatientId == id && a.Action == "write"),
         await db.AmbulanzprotokollRevisions.CountAsync(a => a.PatientId == id),
         await db.PatientWriteReceipts.CountAsync(a => a.PatientId == id));
    private static object Order(string kind, int value, DateTime time) => kind switch
    {
        "triage" => new { transport = value % 2 == 1, clientUpdatedAt = time },
        "respiration" => new { respiration = value % 2 == 1, clientUpdatedAt = time },
        "location" => new { lat = value, lng = 0, source = "manual", accuracyMeters = (double?)null, indoorLocation = (string?)null, clientUpdatedAt = time },
        _ => new { status = "draft", formState = new { patient = new { vorname = value.ToString() } }, clientUpdatedAt = time },
    };
    private static Task<HttpResponseMessage> Request(HttpClient client, int id, string kind, Guid key, object body)
    {
        var path = kind switch { "triage" => "update-triage-color", "protocol" => "ambulanzprotokoll-page1", _ => kind };
        var request = new HttpRequestMessage(kind == "protocol" ? HttpMethod.Put : HttpMethod.Post, $"/api/persons/{id}/{path}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString());
        return client.SendAsync(request);
    }
    private static async Task<JsonElement> Send(HttpClient client, int id, string kind, Guid key, object body)
    {
        using var response = await Request(client, id, kind, key, body);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonElement>()).Clone();
    }
    private static async Task<(HttpClient, int)> Setup(Factory factory)
    {
        var client = factory.CreateClient();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", config["Bootstrap:AdminUsername"] ?? "admin", config["Bootstrap:AdminPassword"]!);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        var scene = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"conflict-{Guid.NewGuid():N}" });
        var sceneId = (await scene.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var patient = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        return (client, (await patient.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32());
    }
    private sealed class Factory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
            services.Remove(services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher))));
    }
}
