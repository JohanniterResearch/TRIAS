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

public class BodyPartIdempotencyTests
{
    private const string Region = "kopf_vorne";
    private record IdResponse(int Id);

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

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, int patientId, string? key, bool isClicked)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, "/api/body-parts")
        {
            Content = JsonContent.Create(new { idpatient = patientId, bodyPartId = Region, isClicked }),
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
    private sealed class BodyPartFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services =>
        {
            var dispatcher = services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher));
            services.Remove(dispatcher);
        });
    }
}
