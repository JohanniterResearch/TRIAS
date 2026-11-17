using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Ambulanzsystem.Tests;

public class PatientWriteReceiptTests
{
    [Fact]
    public async Task Replay_RechecksCurrentPatientSceneAccess()
    {
        using var factory = new ReceiptFactory(); var admin = await Login(factory);
        var scene = await PostId(admin, "/api/operation-scenes", new { name = "allowed" });
        var other = await PostId(admin, "/api/operation-scenes", new { name = "other" });
        var patient = await PostId(admin, "/api/persons/manual", new { operationSceneId = scene });
        var generated = await admin.PostAsJsonAsync("/api/login-qr-codes/generate", new { number = 1, eventSceneId = scene });
        var qr = (await generated.Content.ReadFromJsonAsync<JsonElement>())[0].GetProperty("qrToken").GetString();
        var scoped = factory.CreateClient();
        var login = await scoped.PostAsJsonAsync("/api/qr-login", new { qr_code = qr });
        scoped.DefaultRequestHeaders.Authorization = new("Bearer", (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString());
        var key = Guid.NewGuid().ToString(); var url = $"/api/persons/{patient}/respiration"; var body = new { respiration = true };
        (await Send(scoped, url, key, body)).EnsureSuccessStatusCode();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Patients.FindAsync(patient))!.OperationSceneId = other; await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(scoped, url, key, body)).StatusCode);
    }

    [Fact]
    public async Task SameUuid_HasIndependentScopesAndTargets()
    {
        using var factory = new ReceiptFactory(); var client = await Login(factory);
        var scene = await PostId(client, "/api/operation-scenes", new { name = "scopes" });
        var first = await PostId(client, "/api/persons/manual", new { operationSceneId = scene });
        var second = await PostId(client, "/api/persons/manual", new { operationSceneId = scene });
        var team = await PostId(client, "/api/teams", new { operationSceneId = scene, name = "scopes" });
        var key = Guid.NewGuid().ToString();
        (await Send(client, $"/api/persons/{first}/respiration", key, new { respiration = true })).EnsureSuccessStatusCode();
        (await Send(client, $"/api/persons/{second}/respiration", key, new { respiration = false })).EnsureSuccessStatusCode();
        (await Send(client, $"/api/teams/{team}", key, new { assignedPatientId = first })).EnsureSuccessStatusCode();
        using var scope = factory.Services.CreateScope();
        Assert.Equal(3, await scope.ServiceProvider.GetRequiredService<AppDbContext>().PatientWriteReceipts.CountAsync(r => r.WriteId == Guid.Parse(key)));
    }

    [Theory]
    [InlineData("manual")]
    [InlineData("qr-intake")]
    [InlineData("qr-reassign")]
    [InlineData("respiration")]
    [InlineData("admin-patient")]
    [InlineData("admin-body")]
    [InlineData("admin-qr")]
    [InlineData("team")]
    [InlineData("protocol-export")]
    public async Task FirstDelivery_LostResponse_ParallelRetries_ChangedContents_AndRestart(string kind)
    {
        using var factory = new ReceiptFactory();
        var client = await Login(factory);
        var scene = await PostId(client, "/api/operation-scenes", new { name = Guid.NewGuid().ToString() });
        var patient = await PostId(client, "/api/persons/manual", new { operationSceneId = scene });
        var tokens = (await (await client.PostAsJsonAsync("/api/patient-qr-codes/generate", new { number = 3 })).Content.ReadFromJsonAsync<string[]>())!;
        var team = await PostId(client, "/api/teams", new { operationSceneId = scene, name = "receipt team" });
        var search = await client.GetFromJsonAsync<JsonElement>($"/api/admin/patients?operationSceneId={scene}");
        var reference = search.GetProperty("items")[0].GetProperty("editReference").GetString();
        var key = Guid.NewGuid().ToString();
        object body; object changed; string url;
        var parts = JsonSerializer.Deserialize<Dictionary<string, int>>(BodyRegions.DefaultBodyPartsJson())!;
        switch (kind)
        {
            case "manual": url = "/api/persons/manual"; body = new { operationSceneId = scene, name = "same", clientGeneratedId = key }; changed = new { operationSceneId = scene, name = "changed", clientGeneratedId = key }; break;
            case "qr-intake": url = "/api/verify-patient-qr-code"; body = new { qr_code = tokens[0], operationSceneId = scene }; changed = new { qr_code = tokens[0], operationSceneId = await PostId(client, "/api/operation-scenes", new { name = "changed" }) }; break;
            case "qr-reassign": url = $"/api/persons/{patient}/reassign-qr-code"; body = new { qr_code = tokens[0] }; changed = new { qr_code = tokens[1] }; break;
            case "respiration": url = $"/api/persons/{patient}/respiration"; body = new { respiration = true }; changed = new { respiration = false }; break;
            case "admin-patient": url = $"/api/admin/patients/{reference}"; body = new { name = "same", correctionReason = "test" }; changed = new { name = "changed", correctionReason = "test" }; break;
            case "admin-body": url = $"/api/admin/patients/{reference}/body-parts"; body = new { bodyParts = parts, correctionReason = "test" }; changed = new { bodyParts = parts, correctionReason = "changed" }; break;
            case "admin-qr": url = $"/api/admin/patients/{reference}/assign-qr-code"; body = new { source = "new" }; changed = new { source = "existing", qrReference = "changed" }; break;
            case "protocol-export": url = $"/api/persons/{patient}/ambulanzprotokoll-page1/export"; body = new { }; changed = new { }; break;
            default: url = $"/api/teams/{team}"; body = new { assignedPatientId = patient }; changed = new { assignedPatientId = (int?)null }; break;
        }
        Drain(factory);
        var first = await Send(client, url, key, body);
        first.EnsureSuccessStatusCode();
        var original = JsonNode.Parse(await first.Content.ReadAsStringAsync());
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var expectedPatients = kind is "manual" or "qr-intake" ? 2 : 1;
            var ids = await db.Patients.Where(p => p.OperationSceneId == scene).Select(p => p.Id).ToListAsync();
            Assert.Equal(expectedPatients, ids.Count);
            Assert.Equal(expectedPatients, await db.Bodies.CountAsync(b => ids.Contains(b.PatientId)));
            Assert.Equal(2, await db.AuditLogs.CountAsync(a => ids.Contains(a.PatientId ?? 0)));
            Assert.Equal(kind == "admin-qr" ? 4 : 3,
                await db.QrCodePatients.CountAsync(q => tokens.Contains(q.QrToken) || ids.Contains(q.PatientId ?? 0)));
        }
        var snapshot = await Snapshot(factory, scene, tokens);
        var replies = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Send(client, url, key, body)));
        foreach (var reply in replies)
        {
            Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
            var replay = JsonNode.Parse(await reply.Content.ReadAsStringAsync());
            if (kind == "respiration")
            {
                // LWW responses refresh current patient data; PG timestamps have microsecond precision.
                if (original!["updatedAt"] is not null)
                    Assert.True(Math.Abs(DateTime.Parse(original["updatedAt"]!.GetValue<string>()).Ticks - DateTime.Parse(replay!["updatedAt"]!.GetValue<string>()).Ticks) < 10);
                original.AsObject().Remove("updatedAt");
                replay!.AsObject().Remove("updatedAt");
            }
            Assert.True(JsonNode.DeepEquals(original, replay));
        }
        if (kind != "protocol-export") Assert.Equal(HttpStatusCode.Conflict, (await Send(client, url, key, changed)).StatusCode);
        Assert.Equal(snapshot, await Snapshot(factory, scene, tokens));
        using (var scope = factory.Services.CreateScope())
            Assert.Single(await scope.ServiceProvider.GetRequiredService<AppDbContext>().PatientWriteReceipts.Where(r => r.WriteId == Guid.Parse(key)).ToListAsync());
        // A new UUID must be a distinct order even for identical business values.
        if (kind is "admin-patient" or "admin-body" or "admin-qr" or "respiration" or "team" or "protocol-export")
        {
            (await Send(client, url, Guid.NewGuid().ToString(), body)).EnsureSuccessStatusCode();
            Assert.NotEqual(snapshot, await Snapshot(factory, scene, tokens));
            snapshot = await Snapshot(factory, scene, tokens);
            // An old QR replay must not rebind the first QR over the second assignment.
            (await Send(client, url, key, body)).EnsureSuccessStatusCode();
            Assert.Equal(snapshot, await Snapshot(factory, scene, tokens));
        }
        if (kind == "qr-reassign")
        {
            (await Send(client, url, Guid.NewGuid().ToString(), new { qr_code = tokens[1] })).EnsureSuccessStatusCode();
            snapshot = await Snapshot(factory, scene, tokens);
            (await Send(client, url, key, body)).EnsureSuccessStatusCode();
            Assert.Equal(snapshot, await Snapshot(factory, scene, tokens));
        }
        using var restarted = new ReceiptFactory();
        var retry = await Send(await Login(restarted), url, key, body);
        retry.EnsureSuccessStatusCode();
        var restartedReply = JsonNode.Parse(await retry.Content.ReadAsStringAsync());
        if (kind == "respiration") restartedReply!.AsObject().Remove("updatedAt");
        Assert.True(JsonNode.DeepEquals(original, restartedReply));
        Assert.Equal(0, restarted.Services.GetRequiredService<RealtimePublisher>().PendingCount);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(restarted.CreateClient(), url, key, body)).StatusCode);
    }

    [Fact]
    public async Task SeparateManualIntakes_WithSameName_CreateTwoPatients()
    {
        using var factory = new ReceiptFactory(); var client = await Login(factory);
        var scene = await PostId(client, "/api/operation-scenes", new { name = "two intakes" });
        var ids = new List<int>();
        foreach (var key in new[] { Guid.NewGuid(), Guid.NewGuid() })
            ids.Add(await PostId(client, "/api/persons/manual", new { operationSceneId = scene, name = "identical", clientGeneratedId = key }));
        Assert.NotEqual(ids[0], ids[1]);
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(2, await db.Patients.CountAsync(p => p.OperationSceneId == scene));
        Assert.Equal(2, await db.PatientWriteReceipts.CountAsync(r => ids.Contains(r.PatientId ?? 0)));
    }

    [Fact]
    public async Task FailureWhenSavingReceipt_RollsBackCreationAuditAndPublications()
    {
        var failure = new ReceiptFailure(); using var factory = new ReceiptFactory(failure); var client = await Login(factory);
        var scene = await PostId(client, "/api/operation-scenes", new { name = "rollback receipt" });
        Drain(factory); var key = Guid.NewGuid().ToString(); var body = new { operationSceneId = scene, clientGeneratedId = key };
        failure.Armed = true;
        Assert.Equal(HttpStatusCode.InternalServerError, (await Send(client, "/api/persons/manual", key, body)).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.Patients.AnyAsync(p => p.OperationSceneId == scene));
            Assert.False(await db.PatientWriteReceipts.AnyAsync(r => r.WriteId == Guid.Parse(key)));
        }
        Assert.Equal(0, factory.Services.GetRequiredService<RealtimePublisher>().PendingCount);
        (await Send(client, "/api/persons/manual", key, body)).EnsureSuccessStatusCode();
    }

    private static async Task<string> Snapshot(ReceiptFactory factory, int scene, string[] tokens)
    {
        using var scope = factory.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var ids = await db.Patients.Where(p => p.OperationSceneId == scene).Select(p => p.Id).ToListAsync();
        return JsonSerializer.Serialize(new {
            patients = await db.Patients.AsNoTracking().Where(p => ids.Contains(p.Id)).OrderBy(p => p.Id).ToListAsync(),
            qr = await db.QrCodePatients.AsNoTracking().Where(q => tokens.Contains(q.QrToken) || ids.Contains(q.PatientId ?? 0)).OrderBy(q => q.Id).ToListAsync(),
            bodies = await db.Bodies.AsNoTracking().Where(b => ids.Contains(b.PatientId)).OrderBy(b => b.Id).ToListAsync(),
            audit = await db.AuditLogs.AsNoTracking().Where(a => ids.Contains(a.PatientId ?? 0)).OrderBy(a => a.Id).ToListAsync(),
            teams = await db.Teams.AsNoTracking().Where(t => t.OperationSceneId == scene).OrderBy(t => t.Id).ToListAsync(),
            exports = await db.AmbulanzprotokollExports.AsNoTracking().Where(e => ids.Contains(e.PatientId)).OrderBy(e => e.Id).ToListAsync(),
            published = factory.Services.GetRequiredService<RealtimePublisher>().PendingCount,
        });
    }
    private static async Task<HttpClient> Login(ReceiptFactory factory)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(client, "/api/admin-login", "admin", "dev-admin-password")); return client;
    }
    private static async Task<int> PostId(HttpClient client, string url, object body)
    { var response = await client.PostAsJsonAsync(url, body); response.EnsureSuccessStatusCode(); return (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32(); }
    private static Task<HttpResponseMessage> Send(HttpClient client, string url, string key, object body)
    {
        var method = url.EndsWith("/export") ? HttpMethod.Get : url.Contains("/api/admin/patients/") && !url.EndsWith("assign-qr-code") || url.StartsWith("/api/teams/") ? HttpMethod.Put : HttpMethod.Post;
        var request = new HttpRequestMessage(method, url) { Content = JsonContent.Create(body) }; request.Headers.Add("Idempotency-Key", key); return client.SendAsync(request);
    }
    private static void Drain(ReceiptFactory factory) { while (factory.Services.GetRequiredService<RealtimePublisher>().Reader.TryRead(out _)) { } }
    private sealed class ReceiptFactory(ReceiptFailure? failure = null) : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.ConfigureServices(services => {
            services.Remove(services.Single(s => s.ServiceType == typeof(IHostedService) && s.ImplementationType == typeof(RealtimeDispatcher)));
            if (failure is not null) { services.RemoveAll<DbContextOptions<AppDbContext>>(); services.AddDbContext<AppDbContext>(o => o.UseNpgsql(TestDatabaseIsolation.TestConnectionString).UseSnakeCaseNamingConvention().AddInterceptors(failure)); }
        });
    }
    private sealed class ReceiptFailure : SaveChangesInterceptor
    {
        public bool Armed { get; set; }
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { if (Armed && eventData.Context!.ChangeTracker.Entries<PatientWriteReceipt>().Any(e => e.State == EntityState.Added)) { Armed = false; throw new InvalidOperationException("receipt failure"); } return ValueTask.FromResult(result); }
    }
}
