using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
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

public class TriageIdempotencyTests
{
    private static readonly DateTime Timestamp = DateTime.UtcNow.AddMinutes(-10);
    private record IdResponse(int Id);

    [Fact]
    public async Task Checksum_WithAdditionalOptionalNullFields_MatchesEarlierDtoShape()
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid();
        // Simulate an earlier DTO without the optional boolean fields of TriageUpdateRequest.
        var earlierDto = new { TriageColor = "rot", ClientUpdatedAt = Timestamp };
        var expectedChecksum = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(earlierDto)));

        (await SendAsync(client, patientId, key.ToString(),
            new { triageColor = "rot", clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(expectedChecksum, (await db.TriageProcessedWrites.FindAsync(patientId, key))!.Checksum);
        }

        (await SendAsync(client, patientId, key.ToString(),
            new { triageColor = "rot", clientUpdatedAt = Timestamp, respiration = (bool?)null })).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 1, 1);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(false, null)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task SameKeyWithChangedBoolean_ReturnsConflictWithoutEffects(bool? original, bool? changed)
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, patientId, key,
            new { triageColor = "rot", respiration = original, clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();

        var conflict = await SendAsync(client, patientId, key,
            new { triageColor = "rot", respiration = changed, clientUpdatedAt = Timestamp });

        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        await AssertEffectsAsync(factory, patientId, 1, 1);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(original, (await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Patients.FindAsync(patientId))!.Atmung);
    }

    [Fact]
    public async Task Replay_DoesNotWriteAuditOrPublish_AndReturnsCurrentPatient()
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var order = new { triageColor = "rot", clientUpdatedAt = Timestamp };
        (await SendAsync(client, patientId, key, order)).EnsureSuccessStatusCode();
        // A distinct change may have the same content and must still be processed.
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(), order)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(),
            new { triageColor = "gelb", clientUpdatedAt = Timestamp.AddMinutes(1) })).EnsureSuccessStatusCode();
        var replay = await SendAsync(client, patientId, key, order);
        replay.EnsureSuccessStatusCode();
        Assert.Equal("gelb", (await replay.Content.ReadFromJsonAsync<PatientResponse>())!.Triagefarbe);
        await AssertEffectsAsync(factory, patientId, 3, 3);
    }

    [Fact]
    public async Task ParallelReplays_ApplyAuditAndPublishExactlyOnce()
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = Enumerable.Range(0, 8).Select(async _ =>
        {
            await start.Task;
            return await SendAsync(client, patientId, key,
                new { triageColor = "rot", clientUpdatedAt = Timestamp });
        }).ToArray();
        start.SetResult();
        Assert.All(await Task.WhenAll(requests), response => response.EnsureSuccessStatusCode());
        await AssertEffectsAsync(factory, patientId, 1, 1);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SameKeyWithDifferentOrder_ReturnsConflictWithoutEffects(bool changeTimestamp)
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, patientId, key,
            new { triageColor = "rot", clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();
        var conflict = await SendAsync(client, patientId, key, new
        {
            triageColor = changeTimestamp ? "rot" : "gelb",
            clientUpdatedAt = changeTimestamp ? Timestamp.AddMinutes(1) : Timestamp,
        });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        await AssertEffectsAsync(factory, patientId, 1, 1);
        using var scope = factory.Services.CreateScope();
        Assert.Equal("rot", (await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Patients.FindAsync(patientId))!.Triagefarbe);
    }

    [Theory]
    [InlineData("not-a-uuid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("11111111111111111111111111111111")]
    [InlineData(" 11111111-1111-1111-1111-111111111111 ")]
    [InlineData("11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222")]
    public async Task InvalidKey_IsRejectedBeforePatientProcessing(string key)
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        var response = await SendAsync(client, patientId, key, new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertEffectsAsync(factory, patientId, 0, 0);
        var missingPatient = await SendAsync(client, int.MaxValue, key, new { triageColor = "rot" });
        Assert.Equal(HttpStatusCode.BadRequest, missingPatient.StatusCode);
    }

    [Fact]
    public async Task EmptyKey_IsRejectedBeforeAccessingDatabase()
    {
        // HttpClient drops empty custom headers; supply the received header directly instead.
        var context = new DefaultHttpContext();
        context.Request.Headers["Idempotency-Key"] = "";
        var controller = new PersonsController(null!, null!, null!)
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
        Assert.IsType<BadRequestObjectResult>(await controller.UpdateTriageColor(1,
            new TriageUpdateRequest("rot", null, null, null, null, null, null, null)));
    }

    [Fact]
    public async Task Rollback_AfterDatabaseWrite_DoesNotConsumeKeyOrLeaveAuditOrNotification()
    {
        var failure = new FailAfterTriageSave();
        using var factory = new TriageFactory(failure);
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        failure.PatientId = patientId;
        var failed = await SendAsync(client, patientId, key,
            new { triageColor = "rot", clientUpdatedAt = Timestamp });
        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        await AssertEffectsAsync(factory, patientId, 0, 0);
        using (var scope = factory.Services.CreateScope())
        {
            Assert.Null((await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .Patients.FindAsync(patientId))!.Triagefarbe);
        }
        // A different order with this key can succeed because neither key nor checksum committed.
        (await SendAsync(client, patientId, key,
            new { triageColor = "gelb", clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 1, 1);
    }

    [Fact]
    public async Task Replay_AfterHostRestart_UsesPersistedKeyAndChecksum()
    {
        var key = Guid.NewGuid().ToString();
        int patientId;
        var order = new { triageColor = "rot", clientUpdatedAt = Timestamp };
        using (var first = new TriageFactory())
        {
            var setup = await SetupAsync(first);
            patientId = setup.PatientId;
            (await SendAsync(setup.Client, patientId, key, order)).EnsureSuccessStatusCode();
            await AssertEffectsAsync(first, patientId, 1, 1);
        }
        using var restarted = new TriageFactory();
        var client = await AdminClientAsync(restarted);
        // JSON property order does not change the bound triage order.
        (await SendAsync(client, patientId, key,
            new { clientUpdatedAt = Timestamp, triageColor = "rot" })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, patientId, key,
            new { triageColor = "gelb", clientUpdatedAt = Timestamp })).StatusCode);
        await AssertEffectsAsync(restarted, patientId, 1, 0);
    }

    [Fact]
    public async Task OlderOrder_IsRememberedEvenWhenFieldMergeSkipsIt()
    {
        using var factory = new TriageFactory();
        var (client, patientId) = await SetupAsync(factory);
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(),
            new { triageColor = "rot", clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();
        var key = Guid.NewGuid().ToString();
        var order = new { triageColor = "gelb", clientUpdatedAt = Timestamp.AddMinutes(-1) };
        (await SendAsync(client, patientId, key, order)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, key, order)).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 2, 2, auditCount: 1);
    }

    private static async Task<HttpClient> AdminClientAsync(TriageFactory factory)
    {
        var client = factory.CreateClient();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login",
            config["Bootstrap:AdminUsername"] ?? "admin", config["Bootstrap:AdminPassword"]!);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<(HttpClient Client, int PatientId)> SetupAsync(TriageFactory factory)
    {
        var client = await AdminClientAsync(factory);
        var scene = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"triage-idempotency-{Guid.NewGuid():N}" });
        scene.EnsureSuccessStatusCode();
        var sceneId = (await scene.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var response = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        response.EnsureSuccessStatusCode();
        var patientId = (await response.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        while (publisher.Reader.TryRead(out _)) { }
        return (client, patientId);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, int patientId, string key, object order)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/persons/{patientId}/update-triage-color")
        {
            Content = JsonContent.Create(order),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task AssertEffectsAsync(TriageFactory factory, int patientId, int processedCount, int notificationCount, int? auditCount = null)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(processedCount, await db.TriageProcessedWrites.CountAsync(w => w.PatientId == patientId));
        Assert.Equal(auditCount ?? processedCount, await db.AuditLogs.CountAsync(a => a.PatientId == patientId && a.ChangedFieldsJson == "[\"triagefarbe\"]"));
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        var notifications = new List<QueuedMessage>();
        while (publisher.Reader.TryRead(out var message)) notifications.Add(message);
        Assert.Equal(notificationCount, notifications.Count);
        Assert.All(notifications, message => Assert.Equal(patientId, Assert.IsType<PatientUpdatedMessage>(message.Payload).Patient.Id));
    }

    // Keep the real publisher, but stop its background consumer so enqueue counts are deterministic.
    private sealed class TriageFactory(FailAfterTriageSave? failure = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
        {
            var dispatcher = services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher));
            services.Remove(dispatcher);
            if (failure is not null)
            {
                services.RemoveAll<DbContextOptions<AppDbContext>>();
                services.AddDbContext<AppDbContext>(options => options
                    .UseNpgsql(TestDatabaseIsolation.TestConnectionString)
                    .UseSnakeCaseNamingConvention()
                    .AddInterceptors(failure));
            }
        });
    }

    private sealed class FailAfterTriageSave : SaveChangesInterceptor
    {
        public int? PatientId { get; set; }

        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            if (PatientId is int patientId && eventData.Context!.ChangeTracker.Entries<TriageProcessedWrite>().Any(e => e.Entity.PatientId == patientId))
            {
                PatientId = null;
                throw new InvalidOperationException("Injected failure after triage save, before commit.");
            }
            return ValueTask.FromResult(result);
        }
    }
}
