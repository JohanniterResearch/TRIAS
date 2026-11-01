using System.Net;
using System.Net.Http.Json;
using Ambulanzsystem.Api.Controllers;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Ambulanzsystem.Tests;

public class LocationIdempotencyTests
{
    private static readonly DateTime Timestamp = DateTime.UtcNow.AddMinutes(-10);
    private record IdResponse(int Id);

    [Fact]
    public async Task Replay_DoesNotWriteAuditOrPublish_AndReturnsCurrentPatient()
    {
        using var factory = new LocationFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var order = new { lat = 48.2, lng = 16.3, clientUpdatedAt = Timestamp };
        (await SendAsync(client, patientId, key, order)).EnsureSuccessStatusCode();
        // A distinct order with a new key is a new change and must still be processed.
        (await SendAsync(client, patientId, Guid.NewGuid().ToString(),
            new { lat = 47.1, lng = 15.4, clientUpdatedAt = Timestamp.AddMinutes(1) })).EnsureSuccessStatusCode();

        var replay = await SendAsync(client, patientId, key, order);

        replay.EnsureSuccessStatusCode();
        Assert.Equal(47.1, (await replay.Content.ReadFromJsonAsync<PatientResponse>())!.LatitudePatient);
        await AssertEffectsAsync(factory, patientId, 2, 2);
    }

    [Fact]
    public async Task ParallelReplays_ApplyAuditAndPublishExactlyOnce()
    {
        using var factory = new LocationFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var requests = Enumerable.Range(0, 8).Select(async _ =>
        {
            await start.Task;
            return await SendAsync(client, patientId, key, new { lat = 48.2, lng = 16.3, clientUpdatedAt = Timestamp });
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
        using var factory = new LocationFactory();
        var (client, patientId) = await SetupAsync(factory);
        var key = Guid.NewGuid().ToString();
        (await SendAsync(client, patientId, key,
            new { lat = 48.2, lng = 16.3, clientUpdatedAt = Timestamp })).EnsureSuccessStatusCode();

        var conflict = await SendAsync(client, patientId, key, new
        {
            lat = changeTimestamp ? 48.2 : 47.1,
            lng = 16.3,
            clientUpdatedAt = changeTimestamp ? Timestamp.AddMinutes(1) : Timestamp,
        });

        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        await AssertEffectsAsync(factory, patientId, 1, 1);
        using var scope = factory.Services.CreateScope();
        Assert.Equal(48.2, (await scope.ServiceProvider.GetRequiredService<AppDbContext>()
            .Patients.FindAsync(patientId))!.LatitudePatient);
    }

    [Fact]
    public async Task WithoutKey_KeepsExistingBehavior()
    {
        using var factory = new LocationFactory();
        var (client, patientId) = await SetupAsync(factory);
        var order = new { lat = 48.2, lng = 16.3, clientUpdatedAt = Timestamp };
        (await SendAsync(client, patientId, null, order)).EnsureSuccessStatusCode();
        (await SendAsync(client, patientId, null, order)).EnsureSuccessStatusCode();
        await AssertEffectsAsync(factory, patientId, 0, 2, auditCount: 2);
    }

    [Theory]
    [InlineData("not-a-uuid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("11111111111111111111111111111111")]
    [InlineData("11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222")]
    public async Task InvalidKey_IsRejectedBeforeProcessing(string key)
    {
        using var factory = new LocationFactory();
        var (client, patientId) = await SetupAsync(factory);
        var response = await SendAsync(client, patientId, key, new { lat = 48.2, lng = 16.3 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await AssertEffectsAsync(factory, patientId, 0, 0);
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
        Assert.IsType<BadRequestObjectResult>(await controller.UpdateLocation(1,
            new LocationRequest(48.2, 16.3, null, null, null, null)));
    }

    [Fact]
    public async Task Replay_AfterHostRestart_UsesPersistedKeyAndChecksum()
    {
        var key = Guid.NewGuid().ToString();
        int patientId;
        var order = new { lat = 48.2, lng = 16.3, clientUpdatedAt = Timestamp };
        using (var first = new LocationFactory())
        {
            var setup = await SetupAsync(first);
            patientId = setup.PatientId;
            (await SendAsync(setup.Client, patientId, key, order)).EnsureSuccessStatusCode();
            await AssertEffectsAsync(first, patientId, 1, 1);
        }
        using var restarted = new LocationFactory();
        var client = await AdminClientAsync(restarted);
        // JSON property order does not change the bound location order.
        (await SendAsync(client, patientId, key,
            new { clientUpdatedAt = Timestamp, lng = 16.3, lat = 48.2 })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, patientId, key,
            new { lat = 47.1, lng = 16.3, clientUpdatedAt = Timestamp })).StatusCode);
        await AssertEffectsAsync(restarted, patientId, 1, 0, auditCount: 1);
    }

    private static async Task<HttpClient> AdminClientAsync(LocationFactory factory)
    {
        var client = factory.CreateClient();
        var config = factory.Services.GetRequiredService<IConfiguration>();
        var token = await TestAuth.LoginAsync(client, "/api/admin-login",
            config["Bootstrap:AdminUsername"] ?? "admin", config["Bootstrap:AdminPassword"]!);
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);
        return client;
    }

    private static async Task<(HttpClient Client, int PatientId)> SetupAsync(LocationFactory factory)
    {
        var client = await AdminClientAsync(factory);
        var scene = await client.PostAsJsonAsync("/api/operation-scenes", new { name = $"location-idempotency-{Guid.NewGuid():N}" });
        scene.EnsureSuccessStatusCode();
        var sceneId = (await scene.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var response = await client.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = sceneId });
        response.EnsureSuccessStatusCode();
        var patientId = (await response.Content.ReadFromJsonAsync<IdResponse>())!.Id;
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        while (publisher.Reader.TryRead(out _)) { }
        return (client, patientId);
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, int patientId, string? key, object order)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/api/persons/{patientId}/location")
        {
            Content = JsonContent.Create(order),
        };
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return client.SendAsync(request);
    }

    private static async Task AssertEffectsAsync(LocationFactory factory, int patientId, int processedCount, int notificationCount, int? auditCount = null)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(processedCount, await db.LocationProcessedWrites.CountAsync(w => w.PatientId == patientId));
        Assert.Equal(auditCount ?? processedCount, await db.AuditLogs.CountAsync(a => a.PatientId == patientId && a.ChangedFieldsJson == "[\"location\"]"));
        var publisher = factory.Services.GetRequiredService<RealtimePublisher>();
        var notifications = new List<QueuedMessage>();
        while (publisher.Reader.TryRead(out var message)) notifications.Add(message);
        Assert.Equal(notificationCount, notifications.Count);
        Assert.All(notifications, message => Assert.Equal(patientId, Assert.IsType<PatientUpdatedMessage>(message.Payload).Patient.Id));
    }

    // Keep the real publisher, but stop its background consumer so enqueue counts are deterministic.
    private sealed class LocationFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
        {
            var dispatcher = services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher));
            services.Remove(dispatcher);
        });
    }
}
