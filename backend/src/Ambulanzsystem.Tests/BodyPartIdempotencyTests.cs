using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Ambulanzsystem.Tests;

public class BodyPartIdempotencyTests
{
    private const string Region = "kopf_vorne";
    private record IdResponse(int Id);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task LateOlderOrder_AndItsRetry_PreserveNewerMarkOrRemoval(bool newerValue)
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var newerTime = new DateTime(2026, 11, 1, 10, 2, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), newerValue, newerTime)).EnsureSuccessStatusCode();
        var before = await SnapshotAsync(factory, patientId);
        var olderKey = Guid.NewGuid().ToString();
        var rejected = await SendAsync(client, patientId, olderKey, !newerValue, newerTime.AddMinutes(-2));
        rejected.EnsureSuccessStatusCode();
        Assert.Equal(new BodyPartWriteResult("rejected", "older_edit", Region, newerValue ? 1 : 0),
            (await rejected.Content.ReadFromJsonAsync<BodyPartsResponse>())!.WriteResult);
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 2, 1, auditCount: 2);
        var entry = await AuditForWriteAsync(factory, patientId, olderKey);
        AssertAudit(entry, newerValue ? 1 : 0, newerTime, !newerValue ? 1 : 0,
            newerTime.AddMinutes(-2), newerValue ? 1 : 0, newerTime, "rejected_older_edit");
        Assert.Equal("newer_stored_edit", entry.Reason);

        (await SendAsync(client, patientId, olderKey, !newerValue, newerTime.AddMinutes(-2))).EnsureSuccessStatusCode();
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 2, 0, auditCount: 2);
        Assert.Equal(entry.AfterJson, (await AuditForWriteAsync(factory, patientId, olderKey)).AfterJson);
        Assert.Equal(newerValue ? 1 : 0, await MarkerAsync(client, patientId));
    }

    [Fact]
    public async Task DifferentRegions_HaveIndependentEditTimes()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var time = new DateTime(2026, 11, 1, 10, 2, 0, DateTimeKind.Utc);
        const string otherRegion = "hand_links_vorne";
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), true, time)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), true, time.AddMinutes(-1), otherRegion)).EnsureSuccessStatusCode();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var body = await db.Bodies.SingleAsync(b => b.PatientId == patientId);
        var times = JsonSerializer.Deserialize<Dictionary<string, DateTime>>(body.RegionTimestampsJson)!;
        Assert.Equal(time, times[Region]);
        Assert.Equal(time.AddMinutes(-1), times[otherRegion]);
        var parts = JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!;
        Assert.Equal(1, parts[Region]);
        Assert.Equal(1, parts[otherRegion]);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task NewerSameValue_AdvancesTime_AndBlocksIntermediateChange(bool value)
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), value, time)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), value, time.AddMinutes(2))).EnsureSuccessStatusCode();
        var before = await SnapshotAsync(factory, patientId);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), !value, time.AddMinutes(1))).EnsureSuccessStatusCode();
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        using var scope = factory.Services.CreateScope();
        var body = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Bodies.SingleAsync(b => b.PatientId == patientId);
        Assert.Equal(time.AddMinutes(2), JsonSerializer.Deserialize<Dictionary<string, DateTime>>(body.RegionTimestampsJson)![Region]);
        Assert.Equal(value ? 1 : 0, await MarkerAsync(client, patientId));
        await AssertEffectsAsync(factory, patientId, 3, 2, auditCount: 3);
    }

    [Fact]
    public async Task TimestampIsBoundToKey_AndAcceptedRetryDoesNotAdvanceState()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, key, true, time)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false, time.AddMinutes(1))).EnsureSuccessStatusCode();
        var before = await SnapshotAsync(factory, patientId);
        (await SendAsync(client, patientId, key, true, time)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, patientId, key, true, time.AddMinutes(-1))).StatusCode);
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 2, 2);
    }

    [Fact]
    public async Task LegacyChecksum_ReplaysWithoutAcquiringATimestamp()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid();
        (await SendAsync(client, patientId, key.ToString(), true)).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var processed = await db.BodyPartProcessedWrites.FindAsync(patientId, key);
            // Exact pre-change bound DTO shape and serializer options, independent of the new DTO.
            var oldChecksum = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(
                new { Idpatient = patientId, BodyPartId = Region, IsClicked = true })));
            Assert.Equal(oldChecksum, processed!.Checksum);
            processed.Checksum = oldChecksum;
            await db.SaveChangesAsync();
        }
        var before = await SnapshotAsync(factory, patientId);
        (await SendAsync(client, patientId, key.ToString(), true)).EnsureSuccessStatusCode();
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        Assert.Equal("{}", before.Times);
        await AssertEffectsAsync(factory, patientId, 1, 1);
    }

    [Fact]
    public async Task EqualAndMissingTimes_KeepLegacyAssignmentBehavior_WithoutSyntheticTime()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var future = DateTime.UtcNow.AddYears(1);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), true, future)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false, future)).EnsureSuccessStatusCode();
        Assert.Equal(0, await MarkerAsync(client, patientId));
        var before = await SnapshotAsync(factory, patientId);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), true)).EnsureSuccessStatusCode();
        Assert.Equal(1, await MarkerAsync(client, patientId));
        Assert.Equal(before.Times, (await SnapshotAsync(factory, patientId)).Times);
        using var times = JsonDocument.Parse(before.Times);
        Assert.Equal(future, times.RootElement.GetProperty(Region).GetDateTime());
    }

    private static async Task<(string Parts, string Times, DateTime UpdatedAt)> SnapshotAsync(BodyPartFactory factory, int patientId)
    {
        using var scope = factory.Services.CreateScope();
        var body = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Bodies.AsNoTracking().SingleAsync(b => b.PatientId == patientId);
        return (body.BodyPartsJson, body.RegionTimestampsJson, body.UpdatedAt);
    }

    [Fact]
    public async Task RejectedRetry_AfterRestart_ReturnsOriginalDecisionAndLatestRegionValue()
    {
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        var key = Guid.NewGuid().ToString();
        int patientId;
        using (var first = new BodyPartFactory())
        {
            var (client, id) = await SetupAsync(first);
            patientId = id;
            (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false, time.AddMinutes(1))).EnsureSuccessStatusCode();
            var rejected = await SendAsync(client, patientId, key, true, time);
            Assert.Equal(HttpStatusCode.OK, rejected.StatusCode);
            Assert.Equal(new BodyPartWriteResult("rejected", "older_edit", Region, 0),
                (await rejected.Content.ReadFromJsonAsync<BodyPartsResponse>())!.WriteResult);
            // Simulate losing the first response, then a distinct, newer server change.
            (await SendAsync(client, patientId, Guid.NewGuid().ToString(), true, time.AddMinutes(2))).EnsureSuccessStatusCode();
            await AssertEffectsAsync(first, patientId, 3, 2, auditCount: 3);
        }
        using var restarted = new BodyPartFactory();
        var retryClient = await AdminClientAsync(restarted);
        var before = await SnapshotAsync(restarted, patientId);
        var retry = await SendAsync(retryClient, patientId, key, true, time);
        Assert.Equal(HttpStatusCode.OK, retry.StatusCode);
        var result = (await retry.Content.ReadFromJsonAsync<BodyPartsResponse>())!;
        Assert.Equal(new BodyPartWriteResult("rejected", "older_edit", Region, 1), result.WriteResult);
        Assert.Equal(1, result.BodyParts[Region]);
        Assert.Equal(before, await SnapshotAsync(restarted, patientId));
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(retryClient, patientId, key, true, time.AddSeconds(1))).StatusCode);
        await AssertEffectsAsync(restarted, patientId, 3, 0, auditCount: 3);
        // The original audit must keep the value/time at rejection, not the retry's current 1.
        AssertAudit(await AuditForWriteAsync(restarted, patientId, key), 0, time.AddMinutes(1),
            1, time, 0, time.AddMinutes(1), "rejected_older_edit");
    }

    [Theory]
    [InlineData(true, false)] // Removal is an ordinary value change.
    [InlineData(false, true)]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public async Task NewerEdit_AuditsValueChangeOrTimestampOnly_InOneRow(bool original, bool incoming)
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), original, time)).EnsureSuccessStatusCode();
        var key = Guid.NewGuid().ToString();
        var response = await SendAsync(client, patientId, key, incoming, time.AddMinutes(2));
        response.EnsureSuccessStatusCode();
        Assert.Equal(new BodyPartWriteResult("applied", null, Region, incoming ? 1 : 0),
            (await response.Content.ReadFromJsonAsync<BodyPartsResponse>())!.WriteResult);
        var entry = await AuditForWriteAsync(factory, patientId, key);
        AssertAudit(entry, original ? 1 : 0, time, incoming ? 1 : 0, time.AddMinutes(2),
            incoming ? 1 : 0, time.AddMinutes(2), original == incoming ? "timestamp_only" : "value_changed");
        Assert.Null(entry.Reason);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var username = factory.Services.GetRequiredService<IConfiguration>()["Bootstrap:AdminUsername"] ?? "admin";
            Assert.Equal((await db.Users.SingleAsync(u => u.Username == username)).Id, entry.ActorId);
            Assert.Equal((await db.Bodies.SingleAsync(b => b.PatientId == patientId)).Id, entry.EntityId);
        }
        var state = await SnapshotAsync(factory, patientId);
        (await SendAsync(client, patientId, key, incoming, time.AddMinutes(2))).EnsureSuccessStatusCode();
        Assert.Equal(state, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 2, 2);
        // Existing audit API exposes the enriched snapshots without a contract/schema change.
        var audit = await client.GetFromJsonAsync<AuditQueryResponse>($"/api/audit?patientId={patientId}&entityType=body&action=write");
        Assert.Equal(2, audit!.Total);
        Assert.Equal(entry.AfterJson, audit.Entries.Single(a => a.Id == entry.Id).After);
    }

    [Fact]
    public async Task HistoricalAndMissingTimes_RemainUnknown_AndUnkeyedAuditHasNoWriteId()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        (await SendAsync(client, patientId, null, true)).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var entry = await db.AuditLogs.SingleAsync(a => a.PatientId == patientId && a.EntityType == "body");
            AssertAudit(entry, 0, null, 1, null, 1, null, "value_changed");
            using var after = JsonDocument.Parse(entry.AfterJson!);
            Assert.Equal(JsonValueKind.Null, after.RootElement.GetProperty("writeId").ValueKind);
        }
        var key = Guid.NewGuid().ToString();
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, key, false, time)).EnsureSuccessStatusCode();
        AssertAudit(await AuditForWriteAsync(factory, patientId, key), 1, null, 0, time, 0, time, "value_changed");
        await AssertEffectsAsync(factory, patientId, 1, 2, auditCount: 2);
    }

    [Fact]
    public async Task ParallelRejectedReplays_CreateExactlyOneRejectionAudit()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false, time.AddMinutes(1))).EnsureSuccessStatusCode();
        var before = await SnapshotAsync(factory, patientId);
        var key = Guid.NewGuid().ToString();
        var replies = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => SendAsync(client, patientId, key, true, time)));
        foreach (var reply in replies)
        {
            Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
            Assert.Equal("rejected", (await reply.Content.ReadFromJsonAsync<BodyPartsResponse>())!.WriteResult!.Outcome);
        }
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 2, 1);
        AssertAudit(await AuditForWriteAsync(factory, patientId, key), 0, time.AddMinutes(1), 1, time,
            0, time.AddMinutes(1), "rejected_older_edit");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailureBeforeCommit_RollsBackAuditDecisionAndMarker(bool rejected)
    {
        var failure = new FailAfterBodyPartSave();
        using var factory = new BodyPartFactory(failure);
        var (client, patientId) = await SetupAsync(factory);
        var time = new DateTime(2026, 11, 1, 10, 0, 0, DateTimeKind.Utc);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false, time)).EnsureSuccessStatusCode();
        var before = await SnapshotAsync(factory, patientId);
        var key = Guid.NewGuid().ToString();
        var editTime = rejected ? time.AddMinutes(-1) : time.AddMinutes(1);
        failure.FailNextSave = true;
        Assert.Equal(HttpStatusCode.InternalServerError, (await SendAsync(client, patientId, key, true, editTime)).StatusCode);
        Assert.Equal(before, await SnapshotAsync(factory, patientId));
        await AssertEffectsAsync(factory, patientId, 1, 1);
        (await SendAsync(client, patientId, key, true, editTime)).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 2, rejected ? 0 : 1);
        using var audit = JsonDocument.Parse((await AuditForWriteAsync(factory, patientId, key)).AfterJson!);
        Assert.Equal(rejected ? "rejected_older_edit" : "value_changed", audit.RootElement.GetProperty("decision").GetString());
    }

    private static async Task<AuditLog> AuditForWriteAsync(BodyPartFactory factory, int patientId, string key)
    {
        using var scope = factory.Services.CreateScope();
        var entries = await scope.ServiceProvider.GetRequiredService<AppDbContext>().AuditLogs.AsNoTracking()
            .Where(a => a.PatientId == patientId && a.EntityType == "body").ToListAsync();
        return Assert.Single(entries, a =>
        {
            using var after = JsonDocument.Parse(a.AfterJson!);
            return after.RootElement.GetProperty("writeId").GetString() == key;
        });
    }

    private static void AssertAudit(AuditLog entry, int stored, DateTime? storedTime,
        int requested, DateTime? requestedTime, int result, DateTime? resultTime, string decision)
    {
        Assert.Equal("write", entry.Action);
        Assert.Equal("body", entry.EntityType);
        Assert.Equal($"[\"{Region}\"]", entry.ChangedFieldsJson);
        Assert.NotNull(entry.ActorId);
        Assert.Equal("admin", entry.ActorRole);
        using var before = JsonDocument.Parse(entry.BeforeJson!);
        using var after = JsonDocument.Parse(entry.AfterJson!);
        Assert.Equal(stored, before.RootElement.GetProperty("value").GetInt32());
        Assert.Equal(storedTime, before.RootElement.GetProperty("clientUpdatedAt").Deserialize<DateTime?>());
        Assert.Equal(result, after.RootElement.GetProperty("value").GetInt32());
        Assert.Equal(resultTime, after.RootElement.GetProperty("clientUpdatedAt").Deserialize<DateTime?>());
        Assert.Equal(requested, after.RootElement.GetProperty("requested").GetProperty("value").GetInt32());
        Assert.Equal(requestedTime, after.RootElement.GetProperty("requested").GetProperty("clientUpdatedAt").Deserialize<DateTime?>());
        Assert.Equal(decision, after.RootElement.GetProperty("decision").GetString());
    }

    [Fact]
    public async Task Replay_DoesNotWriteAuditOrPublish_AndReturnsCurrentState()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, patientId, key, true)).EnsureSuccessStatusCode();
        // A distinct order with a new key is a new change and must still be processed.
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), false)).EnsureSuccessStatusCode();

        var replay = await SendAsync(client, patientId, key, true);

        replay.EnsureSuccessStatusCode();
        var state = (await replay.Content.ReadFromJsonAsync<BodyPartsResponse>())!;
        Assert.Equal(0, state.BodyParts[Region]);
        await AssertEffectsAsync(factory, patientId, 2, 2);
    }

    [Fact]
    public async Task ParallelReplays_ApplyAuditAndPublishExactlyOnce()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = Enumerable.Range(0, 8).Select(async _ =>
        {
            await start.Task;
            return await SendAsync(client, patientId, key, true);
        }).ToArray();
        start.SetResult();
        Assert.All(await Task.WhenAll(requests), response => response.EnsureSuccessStatusCode());
        await AssertEffectsAsync(factory, patientId, 1, 1);
    }

    [Fact]
    public async Task SameKeyWithDifferentOrder_ReturnsConflictWithoutEffects()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, patientId, key, true)).EnsureSuccessStatusCode();

        var conflict = await SendAsync(client, patientId, key, false);

        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        await AssertEffectsAsync(factory, patientId, 1, 1);
        Assert.Equal(1, await MarkerAsync(client, patientId));
    }

    [Fact]
    public async Task WithoutKey_KeepsExistingBehavior()
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        (await SendAsync(client, patientId, null, true)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, null, true)).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 0, 2, auditCount: 2);
    }

    [Theory]
    [InlineData("not-a-uuid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("11111111111111111111111111111111")]
    [InlineData("11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222")]
    public async Task InvalidKey_IsRejectedBeforeProcessing(string key)
    {
        using var factory = new BodyPartFactory();
        var (client, patientId) = await SetupAsync(factory);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(client, patientId, key, true)).StatusCode);
        await AssertEffectsAsync(factory, patientId, 0, 0);
    }

    [Fact]
    public async Task EmptyKey_IsRejectedBeforeAccessingDatabase()
    {
        // HttpClient drops empty custom headers; supply the received header directly instead.
        var context = new DefaultHttpContext();
        context.Request.Headers["Idempotency-Key"] = "";
        var controller = new BodyPartsController(null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
        Assert.IsType<BadRequestObjectResult>(await controller.Toggle(new ToggleBodyPartRequest(1, Region, true)));
    }

    [Fact]
    public async Task Replay_AfterHostRestart_UsesPersistedKeyAndChecksum()
    {
        var key = Guid.NewGuid().ToString();
        int patientId;
        using (var first = new BodyPartFactory())
        {
            var setup = await SetupAsync(first);
            patientId = setup.PatientId;
            (await SendAsync(setup.Client, patientId, key, true)).EnsureSuccessStatusCode();
            await AssertEffectsAsync(first, patientId, 1, 1);
        }
        using var restarted = new BodyPartFactory();
        var client = await AdminClientAsync(restarted);
        (await SendAsync(client, patientId, key, true)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, patientId, key, false)).StatusCode);
        await AssertEffectsAsync(restarted, patientId, 1, 0, auditCount: 1);
    }

    private static async Task<HttpClient> AdminClientAsync(BodyPartFactory factory)
    {
        var client = factory.CreateClient();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login",
            config["Bootstrap:AdminUsername"] ?? "admin", config["Bootstrap:AdminPassword"]!);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<(HttpClient Client, int PatientId)> SetupAsync(BodyPartFactory factory)
    {
        var client = await AdminClientAsync(factory);
        var scene = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"body-idempotency-{Guid.NewGuid():N}" });
        scene.EnsureSuccessStatusCode();
        var sceneId = (await scene.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var response = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        response.EnsureSuccessStatusCode();
        var patientId = (await response.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        while (publisher.Reader.TryRead(out _)) { }
        return (client, patientId);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, int patientId, string? key, bool isClicked,
        DateTime? clientUpdatedAt = null, string region = Region)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, "/api/body-parts")
        {
            Content = JsonContent.Create(new { idpatient = patientId, bodyPartId = region, isClicked, clientUpdatedAt }),
        };
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task<int> MarkerAsync(HttpClient client, int patientId) =>
        (await client.GetFromJsonAsync<BodyPartsResponse>($"/api/body-parts?idpatient={patientId}"))!.BodyParts[Region];

    private static async Task AssertEffectsAsync(BodyPartFactory factory, int patientId, int processedCount, int notificationCount, int? auditCount = null)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(processedCount, await db.BodyPartProcessedWrites.CountAsync(w => w.PatientId == patientId));
        Assert.Equal(auditCount ?? processedCount, await db.AuditLogs.CountAsync(a =>
            a.PatientId == patientId && a.EntityType == "body" && a.ChangedFieldsJson == $"[\"{Region}\"]"));
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        var notifications = new List<QueuedMessage>();
        while (publisher.Reader.TryRead(out var message)) notifications.Add(message);
        Assert.Equal(notificationCount, notifications.Count);
    }

    // Keep the real publisher, but stop its background consumer so enqueue counts are deterministic.
    private sealed class BodyPartFactory(FailAfterBodyPartSave? failure = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
        {
            var dispatcher = services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher));
            services.Remove(dispatcher);
            if (failure is not null)
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options => options.UseNpgsql(TestDatabaseIsolation.TestConnectionString)
                    .UseSnakeCaseNamingConvention().AddInterceptors(failure));
            }
        });
    }

    private sealed class FailAfterBodyPartSave : SaveChangesInterceptor
    {
        public bool FailNextSave { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (FailNextSave && eventData.Context!.ChangeTracker.Entries<BodyPartProcessedWrite>().Any())
            {
                FailNextSave = false;
                throw new InvalidOperationException("Injected failure after audit/decision/marker save, before commit.");
            }
            return ValueTask.FromResult(result);
        }
    }
}
