using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
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

public class ProtokollIdempotencyTests
{
    private static readonly DateTime Timestamp = DateTime.UtcNow.AddMinutes(-10);
    private record IdResponse(int Id);
    private record TokenResponse(string Token);
    private record QrCode(string QrToken);

    private static object Order(string status = "draft", string? reason = null) => new
    {
        status, formState = new { patient = new { vorname = "Original" } },
        clientUpdatedAt = Timestamp, correctionReason = reason,
    };

    [Theory]
    [InlineData("draft", false)]
    [InlineData("finalized", false)]
    [InlineData("finalized", true)]
    public async Task Replay_PreservesAllEffectsAndTimestamps(string status, bool correction)
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        if (correction) (await SendAsync(client, id, null, Order("finalized"))).EnsureSuccessStatusCode();
        var key = Guid.NewGuid().ToString();
        var order = Order(status, correction ? "Corrected name" : null);
        var first = await SendAsync(client, id, key, order);
        first.EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        var replay = await SendAsync(client, id, key, order);
        replay.EnsureSuccessStatusCode();
        await AssertSameRecordAsync(first, replay);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        await AssertCountsAsync(factory, id, 1, correction ? 2 : 1, status == "draft" ? 0 : correction ? 2 : 1);
    }

    [Theory]
    [InlineData("draft")]
    [InlineData("finalized")]
    public async Task ParallelReplays_ProcessOnceAcrossIndependentRequests(string status)
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = Enumerable.Range(0, 8).Select(async _ =>
        {
            await start.Task;
            return await SendAsync(client, id, key, Order(status));
        }).ToArray();
        start.SetResult();
        Assert.All(await Task.WhenAll(requests), r => r.EnsureSuccessStatusCode());
        await AssertCountsAsync(factory, id, 1, 1, status == "finalized" ? 1 : 0);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Replay_DoesNotReapplyServerTime_ForAbsentOrFutureClientTime(bool future)
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var order = new { status = "draft", formState = new { patient = new { vorname = "Original" } },
            clientUpdatedAt = future ? (DateTime?)DateTime.UtcNow.AddDays(1) : null };
        (await SendAsync(client, id, key, order)).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        (await SendAsync(client, id, key, order)).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        await AssertCountsAsync(factory, id, 1, 1, 0);
    }

    [Theory]
    [InlineData("status")]
    [InlineData("formState")]
    [InlineData("clientUpdatedAt")]
    [InlineData("correctionReason")]
    public async Task ChangedOrder_WithSameKey_ConflictsWithoutEffects(string changedField)
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var order = JsonSerializer.SerializeToNode(Order())!;
        (await SendAsync(client, id, key, order)).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        order[changedField] = changedField switch
        {
            "status" => JsonSerializer.SerializeToNode("finalized"),
            "formState" => JsonSerializer.SerializeToNode(new { patient = new { vorname = "Changed" } }),
            "clientUpdatedAt" => JsonSerializer.SerializeToNode(Timestamp.AddMinutes(1)),
            _ => JsonSerializer.SerializeToNode("New reason"),
        };
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, id, key, order)).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
    }

    [Fact]
    public async Task ReorderedNestedObjectsAndNullFields_Replay_ButArrayOrderIsDistinct()
    {
        var first = new UpsertProtokollRequest("draft", JsonSerializer.SerializeToElement(new
        {
            patient = new { vorname = "A", familienname = "B" },
            assessment_secondary = new { bodymap = new[] { new { x = 1, y = 2 }, new { x = 3, y = 4 } } },
        }), Timestamp);
        var reordered = first with { FormState = JsonDocument.Parse("""
            {"assessment_secondary":{"bodymap":[{"y":2,"optional":null,"x":1},{"y":4,"x":3}]},
             "patient":{"familienname":"B","optional":null,"vorname":"A"},"optional":null}
            """).RootElement };
        Assert.Equal(ProtokollWriteChecksum.Compute(first), ProtokollWriteChecksum.Compute(reordered));
        var reversed = first with { FormState = JsonDocument.Parse("""
            {"patient":{"vorname":"A","familienname":"B"},
             "assessment_secondary":{"bodymap":[{"x":3,"y":4},{"x":1,"y":2}]}}
            """).RootElement };
        Assert.NotEqual(ProtokollWriteChecksum.Compute(first), ProtokollWriteChecksum.Compute(reversed));
        var absent = new UpsertProtokollRequest("draft", JsonDocument.Parse("{\"patient\":{}}").RootElement, null);
        var explicitNull = absent with { FormState = JsonDocument.Parse("{\"patient\":{\"vorname\":null}}").RootElement };
        Assert.Equal(ProtokollWriteChecksum.Compute(absent), ProtokollWriteChecksum.Compute(explicitNull));
        var changed = absent with { FormState = JsonDocument.Parse("{\"patient\":{\"vorname\":\"Changed\"}}").RootElement };
        Assert.NotEqual(ProtokollWriteChecksum.Compute(absent), ProtokollWriteChecksum.Compute(changed));

        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, id, key, new { status = "draft", formState = new { patient = new { vorname = "A", familienname = "B" } } })).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        (await SendAsync(client, id, key, JsonDocument.Parse("""
            {"formState":{"patient":{"familienname":"B","vorname":"A"}},"status":"draft"}
            """).RootElement)).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        var nullKey = Guid.NewGuid().ToString();
        (await SendAsync(client, id, nullKey, new { status = "draft", formState = new { patient = new { } } })).EnsureSuccessStatusCode();
        snapshot = await SnapshotAsync(factory, id);
        (await SendAsync(client, id, nullKey,
            new { status = "draft", formState = new { patient = new { vorname = (string?)null } } })).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, id, nullKey,
            new { status = "draft", formState = new { patient = new { vorname = "Changed" } } })).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
    }

    [Fact]
    public void Checksum_PreservesFalseZeroAndNullArrayElements()
    {
        var order = new UpsertProtokollRequest("draft",
            JsonDocument.Parse("""{"values":[null,false,0],"object":{"flag":false,"count":0}}""").RootElement, null);
        foreach (var json in new[]
        {
            """{"values":[false,0],"object":{"flag":false,"count":0}}""",
            """{"values":[null,false,0],"object":{"flag":null,"count":0}}""",
            """{"values":[null,false,0],"object":{"flag":false,"count":null}}""",
        })
        {
            Assert.NotEqual(ProtokollWriteChecksum.Compute(order),
                ProtokollWriteChecksum.Compute(order with { FormState = JsonDocument.Parse(json).RootElement }));
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InvalidUtf16WithKey_ReturnsBadRequestWithoutEffects(bool existingProtocol)
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        if (existingProtocol) (await SendAsync(client, id, null, Order())).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        var key = Guid.NewGuid().ToString();
        // Send the escaped lone surrogate verbatim; serializing a .NET string can replace it.
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/persons/{id}/ambulanzprotokoll-page1")
        {
            Content = new StringContent("""
                {"status":"draft","formState":{"patient":{"vorname":"Broken \uD83D"}}}
                """, Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);

        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(request)).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        // Rejection must not reserve the key.
        (await SendAsync(client, id, key, Order())).EnsureSuccessStatusCode();
        await AssertCountsAsync(factory, id, 1, existingProtocol ? 2 : 1, 0);
    }

    [Fact]
    public async Task NewKeysAndUnkeyedRequests_RemainIndependent_UnderCorrectionRules()
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        (await SendAsync(client, id, Guid.NewGuid().ToString(), Order())).EnsureSuccessStatusCode();
        (await SendAsync(client, id, Guid.NewGuid().ToString(), Order())).EnsureSuccessStatusCode();
        (await SendAsync(client, id, null, Order())).EnsureSuccessStatusCode();
        await AssertCountsAsync(factory, id, 2, 3, 0);
        (await SendAsync(client, id, Guid.NewGuid().ToString(), Order("finalized"))).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(client, id, Guid.NewGuid().ToString(), Order("finalized"))).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        (await SendAsync(client, id, Guid.NewGuid().ToString(), Order("finalized", "Reviewed"))).EnsureSuccessStatusCode();
        (await SendAsync(client, id, Guid.NewGuid().ToString(), Order("finalized", "Reviewed"))).EnsureSuccessStatusCode();
        await AssertCountsAsync(factory, id, 5, 6, 3);
    }

    [Fact]
    public async Task Replay_ReturnsCurrentProtocolAndCurrentWarnings_AfterLaterWrites()
    {
        using var factory = new ProtocolFactory();
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, id, key, Order())).EnsureSuccessStatusCode();
        var latest = await SendAsync(client, id, Guid.NewGuid().ToString(), new
        {
            status = "finalized", clientUpdatedAt = Timestamp.AddMinutes(1),
            formState = new { patient = new { vorname = "Latest" } },
        });
        latest.EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        var replay = await SendAsync(client, id, key, Order());
        replay.EnsureSuccessStatusCode();
        await AssertSameRecordAsync(latest, replay);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FirstFinalize_ReplaysForOwnerAndQr_WithoutCorrectionReason(bool qr)
    {
        using var factory = new ProtocolFactory();
        var (admin, _, sceneId) = await SetupAsync(factory);
        HttpClient client;
        if (qr)
        {
            var codes = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = sceneId });
            codes.EnsureSuccessStatusCode();
            var token = (await codes.Content.ReadFromJsonAsync<QrCode[]>())![0].QrToken;
            client = factory.CreateClient();
            var login = await client.PostAsJsonAsync("/api/qr-login", new { qr_code = token });
            login.EnsureSuccessStatusCode();
            client.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<TokenResponse>())!.Token);
        }
        else
        {
            var name = $"protocol-owner-{Guid.NewGuid():N}";
            (await admin.PostAsJsonAsync("/api/users", new { username = name, password = "somePassword1", role = "responder" })).EnsureSuccessStatusCode();
            client = factory.CreateClient();
            client.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(client, "/api/user-login", name, "somePassword1"));
        }
        var created = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        Drain(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, id, key, Order("finalized"))).EnsureSuccessStatusCode();
        var snapshot = await SnapshotAsync(factory, id);
        (await SendAsync(client, id, key, Order("finalized"))).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        await AssertCountsAsync(factory, id, 1, 1, 1);
        var rejected = await SendAsync(client, id, Guid.NewGuid().ToString(), Order("finalized"));
        Assert.Equal(qr ? HttpStatusCode.Forbidden : HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));

        // Replay must still pass authentication and current scene access, including QR sessions.
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(factory.CreateClient(), id, key, Order("finalized"))).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.OperationScenes.FindAsync(sceneId))!.Active = false;
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(client, id, key, Order("finalized"))).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task FailureAfterEitherSave_RollsBackKeyProtocolAuditAndRevision(int save)
    {
        var failure = new FailAfterProtocolSave();
        using var factory = new ProtocolFactory(failure);
        var (client, id, _) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var snapshot = await SnapshotAsync(factory, id);
        failure.SavesUntilFailure = save;
        Assert.Equal(HttpStatusCode.InternalServerError, (await SendAsync(client, id, key, Order("finalized"))).StatusCode);
        Assert.Equal(snapshot, await SnapshotAsync(factory, id));
        // Failed orders do not reserve the key, including its checksum.
        (await SendAsync(client, id, key, Order())).EnsureSuccessStatusCode();
        await AssertCountsAsync(factory, id, 1, 1, 0);
    }

    [Fact]
    public async Task Restart_ReplaysPersistedOrder_AndKeepsDatabaseProcessingTime()
    {
        var key = Guid.NewGuid().ToString();
        int id;
        string snapshot;
        using (var first = new ProtocolFactory())
        {
            var setup = await SetupAsync(first);
            id = setup.Id;
            var response = await SendAsync(setup.Client, id, key, Order("finalized"));
            response.EnsureSuccessStatusCode();
            Drain(first);
            snapshot = await SnapshotAsync(first, id);
        }
        using var restarted = new ProtocolFactory();
        var client = await AdminClientAsync(restarted);
        (await SendAsync(client, id, key, Order("finalized"))).EnsureSuccessStatusCode();
        Assert.Equal(snapshot, await SnapshotAsync(restarted, id));
        await AssertCountsAsync(restarted, id, 1, 1, 1, 0);
    }

    [Fact]
    public async Task ProcessingTime_IsGeneratedByDatabase()
    {
        using var factory = new ProtocolFactory();
        var (_, id, _) = await SetupAsync(factory);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync();
        var now = await db.Database.SqlQuery<DateTime>($"SELECT now() AS \"Value\"").SingleAsync();
        var write = new ProtokollProcessedWrite { PatientId = id, WriteId = Guid.NewGuid(), Checksum = new string('A', 64) };
        db.ProtokollProcessedWrites.Add(write);
        await db.SaveChangesAsync();
        Assert.Equal(now, write.ProcessedAt);
        await tx.CommitAsync();
    }

    [Theory]
    [InlineData("")]
    [InlineData("invalid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("11111111111111111111111111111111")]
    [InlineData("11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222")]
    public async Task InvalidKey_IsRejectedBeforeDatabaseAccess(string key)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers["Idempotency-Key"] = key;
        var controller = new AmbulanzprotokollController(null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
        Assert.IsType<BadRequestObjectResult>(await controller.Upsert(1,
            new UpsertProtokollRequest("draft", JsonDocument.Parse("{}").RootElement, null)));
    }

    private static async Task<HttpClient> AdminClientAsync(ProtocolFactory factory)
    {
        var client = factory.CreateClient();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login", config["Bootstrap:AdminUsername"] ?? "admin", config["Bootstrap:AdminPassword"]!);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<(HttpClient Client, int Id, int SceneId)> SetupAsync(ProtocolFactory factory)
    {
        var client = await AdminClientAsync(factory);
        var scene = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"protocol-idempotency-{Guid.NewGuid():N}" });
        scene.EnsureSuccessStatusCode();
        var sceneId = (await scene.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var response = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        response.EnsureSuccessStatusCode();
        var id = (await response.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        Drain(factory);
        return (client, id, sceneId);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, int id, string? key, object order)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/persons/{id}/ambulanzprotokoll-page1") { Content = JsonContent.Create(order) };
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task AssertSameRecordAsync(HttpResponseMessage first, HttpResponseMessage replay)
    {
        var expected = JsonNode.Parse(await first.Content.ReadAsStringAsync())!;
        var actual = JsonNode.Parse(await replay.Content.ReadAsStringAsync())!;
        foreach (var name in new[] { "updatedAt", "finalizedAt" })
        {
            // PostgreSQL stores microseconds; the first response may still carry .NET ticks.
            Assert.Equal(expected[name]?.GetValue<DateTime>().Ticks / 10, actual[name]?.GetValue<DateTime>().Ticks / 10);
            expected[name] = actual[name]?.DeepClone();
        }
        Assert.True(JsonNode.DeepEquals(expected, actual));
    }

    private static void Drain(ProtocolFactory factory)
    {
        while (factory.Services.GetRequiredService<RealtimePublisher>().Reader.TryRead(out _)) { }
    }

    private static async Task<string> SnapshotAsync(ProtocolFactory factory, int id)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var protocol = await db.AmbulanzprotokollPage1s.AsNoTracking().Where(p => p.PatientId == id)
            .Select(p => new { p.Id, p.Status, p.FormStateJson, p.FieldTimestampsJson, p.CreatedAt, p.UpdatedAt, p.FinalizedAt }).SingleOrDefaultAsync();
        var writes = await db.ProtokollProcessedWrites.AsNoTracking().Where(w => w.PatientId == id).OrderBy(w => w.WriteId).ToListAsync();
        var audits = await db.AuditLogs.AsNoTracking().Where(a => a.PatientId == id && a.EntityType == "ambulanzprotokoll").OrderBy(a => a.Id).ToListAsync();
        var revisions = await db.AmbulanzprotokollRevisions.AsNoTracking().Where(r => r.PatientId == id).OrderBy(r => r.Version).ToListAsync();
        return JsonSerializer.Serialize(new { protocol, writes, audits, revisions, publications = factory.Services.GetRequiredService<RealtimePublisher>().PendingCount });
    }

    private static async Task AssertCountsAsync(ProtocolFactory factory, int id, int writes, int audits, int revisions, int? publications = null)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(writes, await db.ProtokollProcessedWrites.CountAsync(w => w.PatientId == id));
        Assert.Equal(audits, await db.AuditLogs.CountAsync(a => a.PatientId == id && a.EntityType == "ambulanzprotokoll"));
        Assert.Equal(revisions, await db.AmbulanzprotokollRevisions.CountAsync(r => r.PatientId == id));
        Assert.Equal(publications ?? audits, factory.Services.GetRequiredService<RealtimePublisher>().PendingCount);
    }

    private sealed class ProtocolFactory(FailAfterProtocolSave? failure = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
        {
            services.Remove(services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher)));
            if (failure is not null)
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options => options.UseNpgsql(TestDatabaseIsolation.TestConnectionString)
                    .UseSnakeCaseNamingConvention().AddInterceptors(failure));
            }
        });
    }

    private sealed class FailAfterProtocolSave : SaveChangesInterceptor
    {
        public int SavesUntilFailure { get; set; }
        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (SavesUntilFailure > 0 && eventData.Context!.ChangeTracker.Entries<ProtokollProcessedWrite>().Any()
                && --SavesUntilFailure == 0)
                throw new InvalidOperationException("Injected failure after protocol save, before commit.");
            return ValueTask.FromResult(result);
        }
    }
}
