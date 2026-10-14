using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Ambulanzsystem.Api.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MQTTnet;
using MQTTnet.Protocol;
using MQTTnet.Server;

namespace Ambulanzsystem.Tests;

// PLS parity plan WP 7.1, ported from the PLS MqttContractTests: pls/v1 topics, QoS 1 and retain,
// payload schema, redaction switches, the documented differences (triagefarbe "grün", Ambulanzsystem
// body-region keys), and that HTTP writes never depend on the broker.
public class MqttContractTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>, IAsyncLifetime
{
    private sealed record Captured(string Topic, string Payload, MqttQualityOfServiceLevel Qos, bool Retain);
    private sealed record Bearing(int id);

    private readonly List<Captured> messages = [];
    private readonly object gate = new();
    private MqttServer? broker;
    private int brokerPort;

    public async Task InitializeAsync()
    {
        brokerPort = FreePort();
        broker = await StartBrokerAsync(brokerPort);
    }

    public async Task DisposeAsync()
    {
        if (broker is not null) await broker.StopAsync();
        broker?.Dispose();
    }

    private async Task<MqttServer> StartBrokerAsync(int port)
    {
        var server = new MqttFactory().CreateMqttServer(new MqttServerOptionsBuilder().WithDefaultEndpoint().WithDefaultEndpointPort(port).Build());
        server.InterceptingPublishAsync += e =>
        {
            lock (gate)
            {
                messages.Add(new Captured(e.ApplicationMessage.Topic, Encoding.UTF8.GetString(e.ApplicationMessage.PayloadSegment),
                    e.ApplicationMessage.QualityOfServiceLevel, e.ApplicationMessage.Retain));
            }
            return Task.CompletedTask;
        };
        await server.StartAsync();
        return server;
    }

    private WebApplicationFactory<Program> WithMqtt(params (string Key, string Value)[] settings) => factory.WithWebHostBuilder(builder =>
    {
        builder.UseSetting("Mqtt:Enabled", "true");
        builder.UseSetting("Mqtt:BrokerHost", "127.0.0.1");
        builder.UseSetting("Mqtt:BrokerPort", brokerPort.ToString());
        builder.UseSetting("Mqtt:ClientId", $"test-{Guid.NewGuid():N}");
        foreach (var (key, value) in settings) builder.UseSetting(key, value);
    });

    private static async Task<HttpClient> AdminAsync(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", await TestAuth.LoginAsync(app.CreateClient(), "/api/admin-login", "admin", "dev-admin-password"));
        return client;
    }

    private static async Task<(int Patient, int Scene)> PatientAsync(HttpClient admin)
    {
        var scene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"mqtt-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Bearing>())!;
        var patient = (await (await admin.PostAsJsonAsync("/api/persons/manual", new { operationSceneId = scene.id, clientGeneratedId = Guid.NewGuid() })).Content.ReadFromJsonAsync<Bearing>())!;
        return (patient.id, scene.id);
    }

    private async Task<Captured> WaitForAsync(string topic, Func<JsonElement, bool>? match = null, int seconds = 10)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < deadline)
        {
            lock (gate)
            {
                var found = messages.LastOrDefault(m => m.Topic == topic && (match is null || match(JsonDocument.Parse(m.Payload).RootElement)));
                if (found is not null) return found;
            }
            await Task.Delay(50);
        }
        throw new TimeoutException($"No MQTT message on {topic}");
    }

    private static JsonElement Root(Captured message) => JsonDocument.Parse(message.Payload).RootElement;

    [Fact]
    public async Task TriageUpdate_PublishesPatientAndSceneTopics_QoS1Retained_WithSchema()
    {
        await using var app = WithMqtt();
        var admin = await AdminAsync(app);
        var (patientId, sceneId) = await PatientAsync(admin);

        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "rot" })).EnsureSuccessStatusCode();

        var patient = await WaitForAsync($"pls/v1/patients/{patientId}", p => p.GetProperty("triagefarbe").GetString() == "rot");
        Assert.Equal(MqttQualityOfServiceLevel.AtLeastOnce, patient.Qos);
        Assert.True(patient.Retain);
        var root = Root(patient);
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.True(root.TryGetProperty("eventTimestamp", out _));
        Assert.Equal(patientId, root.GetProperty("patientId").GetInt32());
        Assert.Equal(sceneId, root.GetProperty("operationSceneId").GetInt32());
        foreach (var field in new[] { "atmung", "blutung", "radialispuls", "transport", "dringend", "kontaminiert", "bodyParts" })
            Assert.True(root.TryGetProperty(field, out _), $"{field} missing");

        var scene = await WaitForAsync($"pls/v1/scenes/{sceneId}/patients");
        Assert.Equal(MqttQualityOfServiceLevel.AtLeastOnce, scene.Qos);
        Assert.True(scene.Retain);
        var sceneRoot = Root(scene);
        Assert.Equal(1, sceneRoot.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(sceneId, sceneRoot.GetProperty("sceneId").GetInt32());
        Assert.Contains(patientId, sceneRoot.GetProperty("patientIds").EnumerateArray().Select(x => x.GetInt32()));
    }

    [Fact]
    public async Task Green_IsPublishedInThePlsSpelling_AndBodyPartsUseAmbulanzsystemRegions()
    {
        await using var app = WithMqtt();
        var admin = await AdminAsync(app);
        var (patientId, _) = await PatientAsync(admin);

        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "gruen" })).EnsureSuccessStatusCode();
        (await admin.PutAsJsonAsync("/api/body-parts", new { idpatient = patientId, bodyPartId = "bauch_vorne", isClicked = true })).EnsureSuccessStatusCode();

        var root = Root(await WaitForAsync($"pls/v1/patients/{patientId}", p =>
            p.GetProperty("bodyParts").ValueKind == JsonValueKind.Object && p.GetProperty("bodyParts").TryGetProperty("bauch_vorne", out var v) && v.GetInt32() == 1));
        Assert.Equal("grün", root.GetProperty("triagefarbe").GetString());
    }

    [Fact]
    public async Task DefaultConfig_IncludesLocation_ButNotTheName()
    {
        await using var app = WithMqtt();
        var admin = await AdminAsync(app);
        var (patientId, _) = await PatientAsync(admin);

        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/location", new { lat = 48.2, lng = 16.37 })).EnsureSuccessStatusCode();

        var root = Root(await WaitForAsync($"pls/v1/patients/{patientId}", p => p.TryGetProperty("latitude", out var lat) && lat.ValueKind == JsonValueKind.Number));
        Assert.Equal(48.2, root.GetProperty("latitude").GetDouble(), 6);
        Assert.Equal(16.37, root.GetProperty("longitude").GetDouble(), 6);
        Assert.False(root.TryGetProperty("name", out _), "name must be redacted by default");
    }

    [Theory]
    [InlineData("Mqtt:RedactLocation")]
    [InlineData("Mqtt:RedactPersonalData")] // the legacy switch still hides the location
    [InlineData("Features:RedactPersonalData")] // the system-wide switch (on in production) applies too
    public async Task LocationRedaction_OmitsLocationAndName(string setting)
    {
        await using var app = WithMqtt((setting, "true"));
        var admin = await AdminAsync(app);
        var (patientId, _) = await PatientAsync(admin);

        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/location", new { lat = 48.2, lng = 16.37 })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "gelb" })).EnsureSuccessStatusCode();

        var root = Root(await WaitForAsync($"pls/v1/patients/{patientId}", p => p.GetProperty("triagefarbe").GetString() == "gelb"));
        Assert.False(root.TryGetProperty("latitude", out _), "latitude must be redacted");
        Assert.False(root.TryGetProperty("longitude", out _), "longitude must be redacted");
        Assert.False(root.TryGetProperty("name", out _), "name must be redacted");
        Assert.Equal(patientId, root.GetProperty("patientId").GetInt32());
    }

    [Fact]
    public async Task BrokerDown_HttpWritesSucceed_HealthDegrades_AndQueuedStateIsSentAfterReconnect()
    {
        var downPort = FreePort();
        await using var app = factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Mqtt:Enabled", "true");
            builder.UseSetting("Mqtt:BrokerHost", "127.0.0.1");
            builder.UseSetting("Mqtt:BrokerPort", downPort.ToString());
            builder.UseSetting("Mqtt:ClientId", $"test-{Guid.NewGuid():N}");
        });
        var admin = await AdminAsync(app);
        var (patientId, _) = await PatientAsync(admin);

        var started = DateTime.UtcNow;
        var write = await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "schwarz" });
        Assert.Equal(HttpStatusCode.OK, write.StatusCode);
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(3), "the write must not wait for the broker");

        var health = await app.CreateClient().GetAsync("/health");
        var body = await health.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        Assert.Equal("degraded", body.GetProperty("mqtt").GetString());
        Assert.Equal("degraded", body.GetProperty("status").GetString());

        var late = await StartBrokerAsync(downPort);
        try
        {
            var root = Root(await WaitForAsync($"pls/v1/patients/{patientId}", p => p.GetProperty("triagefarbe").GetString() == "schwarz", seconds: 30));
            Assert.Equal(patientId, root.GetProperty("patientId").GetInt32());
        }
        finally
        {
            await late.StopAsync();
            late.Dispose();
        }
    }

    [Fact]
    public async Task MissingPatient_ClearsItsRetainedState()
    {
        await using var app = WithMqtt();
        var admin = await AdminAsync(app); // starts the host and its publisher
        app.Services.GetRequiredService<MqttPublishService>().PatientChanged(int.MaxValue);

        var cleared = await WaitForAsync($"pls/v1/patients/{int.MaxValue}");
        Assert.Equal("", cleared.Payload);
        Assert.True(cleared.Retain);
    }

    [Fact]
    public async Task AfterAnIdleWait_AChangeIsPublishedAtOnce()
    {
        // A timed-out idle wait must not swallow the next wake-up (it then waited a full interval).
        await using var app = WithMqtt(("Mqtt:IdleCheckSeconds", "3"));
        var admin = await AdminAsync(app);
        var (patientId, _) = await PatientAsync(admin);
        await WaitForAsync($"pls/v1/patients/{patientId}");
        await Task.Delay(TimeSpan.FromSeconds(4)); // one idle wait has timed out

        (await admin.PostAsJsonAsync($"/api/persons/{patientId}/update-triage-color", new { triageColor = "rot" })).EnsureSuccessStatusCode();
        await WaitForAsync($"pls/v1/patients/{patientId}", p => p.GetProperty("triagefarbe").GetString() == "rot", seconds: 1);
    }

    [Fact]
    public async Task MovedPatient_IsRemovedFromTheOldScenesList()
    {
        await using var app = WithMqtt();
        var admin = await AdminAsync(app);
        var (patientId, oldScene) = await PatientAsync(admin);
        await WaitForAsync($"pls/v1/scenes/{oldScene}/patients", p => p.GetProperty("patientIds").EnumerateArray().Any(x => x.GetInt32() == patientId));
        var newScene = (await (await admin.PostAsJsonAsync("/api/operation-scenes", new { name = $"mqtt-{Guid.NewGuid():N}" })).Content.ReadFromJsonAsync<Bearing>())!.id;

        using (var scope = app.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Ambulanzsystem.Api.Data.AppDbContext>();
            var patient = await db.Patients.FindAsync(patientId);
            patient!.OperationSceneId = newScene;
            await db.SaveChangesAsync();
        }
        app.Services.GetRequiredService<MqttPublishService>().PatientChanged(patientId);

        await WaitForAsync($"pls/v1/scenes/{newScene}/patients", p => p.GetProperty("patientIds").EnumerateArray().Any(x => x.GetInt32() == patientId));
        await WaitForAsync($"pls/v1/scenes/{oldScene}/patients", p => p.GetProperty("patientIds").EnumerateArray().All(x => x.GetInt32() != patientId));
    }

    [Fact]
    public void PendingQueue_CoalescesRepeatedChanges_AndDropsTheOldestPatientWhenFull()
    {
        var service = new MqttPublishService(null!, Options.Create(new MqttSettings { Enabled = true, PendingQueueCapacity = 3 }),
            new ConfigurationBuilder().Build(), NullLogger<MqttPublishService>.Instance);
        service.PatientChanged(5);
        service.PatientChanged(5);
        service.PatientChanged(6);
        Assert.Equal(2, service.PendingCount); // 5 once
        service.PatientChanged(6);
        service.PatientChanged(7);
        service.PatientChanged(8); // full: patient 5 is dropped
        Assert.Equal(3, service.PendingCount);
        service.PatientChanged(7);
        Assert.Equal(3, service.PendingCount);
    }

    [Theory]
    [InlineData(false, false, "disabled")]
    [InlineData(true, true, "healthy")]
    [InlineData(true, false, "degraded")]
    public void HealthMqttState_DegradesOnlyWhileTheBrokerIsUnreachable(bool enabled, bool connected, string expected) =>
        Assert.Equal(expected, Ambulanzsystem.Api.Endpoints.HealthEndpoint.MqttState(enabled, connected));

    [Fact]
    public async Task Disabled_ByDefault_HealthSaysSo()
    {
        var body = await (await factory.CreateClient().GetAsync("/health")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("disabled", body.GetProperty("mqtt").GetString());
        Assert.Equal("healthy", body.GetProperty("status").GetString());
    }

    private static int FreePort()
    {
        var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
