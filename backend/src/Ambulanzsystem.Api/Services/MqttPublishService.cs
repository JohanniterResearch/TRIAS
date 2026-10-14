using System.Text.Json;
using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MQTTnet;
using MQTTnet.Client;
using MQTTnet.Protocol;

namespace Ambulanzsystem.Api.Services;

// MQTT compatibility feed of the former PLS backend (PLS parity plan WP 7.1): the same pls/v1
// topics, QoS 1 and retain, the same payload with schemaVersion 1. Differences, documented in
// contract/schemas/mqtt-messages.md: triagefarbe "gruen" is published as "grün" (the PLS spelling),
// and bodyParts carries Ambulanzsystem region keys.
public class MqttSettings
{
    // Off unless configured: there is no consumer yet (parity plan D6).
    public bool Enabled { get; set; }
    public string BrokerHost { get; set; } = "localhost";
    public int BrokerPort { get; set; } = 1883;
    public string ClientId { get; set; } = "ambulanzsystem-backend";
    // Required by the production broker (allow_anonymous false): Mqtt__Username / Mqtt__Password.
    public string? Username { get; set; }
    public string? Password { get; set; }
    // Pending patients for broker outages; when full, the oldest pending patient is dropped.
    public int PendingQueueCapacity { get; set; } = 200;
    // How often an idle loop checks the connection.
    public int IdleCheckSeconds { get; set; } = 30;
    // Privacy: the patient name is omitted unless explicitly allowed.
    public bool RedactName { get; set; } = true;
    // Privacy: longitude/latitude are omitted for integrations that must not see positions.
    public bool RedactLocation { get; set; }
    // Legacy switch of the PLS backend: hides name and location together. The system-wide
    // Features:RedactPersonalData (on in production, as for SignalR) has the same effect.
    public bool RedactPersonalData { get; set; }
}

/// <summary>
/// Publishes patient state after each committed change (called from SceneNotifier). Requests never
/// wait for the broker: patient ids go into a bounded queue that one background loop sends while
/// connected, so an outage or a slow broker cannot slow down or fail a triage write.
/// </summary>
public sealed class MqttPublishService(IServiceScopeFactory scopeFactory, IOptions<MqttSettings> options, IConfiguration configuration, ILogger<MqttPublishService> logger)
    : BackgroundService
{
    private readonly MqttSettings settings = options.Value;
    private readonly bool redactPersonalData = options.Value.RedactPersonalData || configuration.GetValue<bool>("Features:RedactPersonalData");
    // Each patient is pending at most once: the publish reads the current state, so repeated
    // changes coalesce and a busy patient cannot push others out. Guarded by `gate`.
    private readonly LinkedList<int> pending = new();
    private readonly HashSet<int> pendingIds = [];
    private readonly object gate = new();
    // A timed-out wait leaves no waiter behind (unlike an abandoned channel read, which would
    // swallow the next wake-up).
    private readonly SemaphoreSlim wake = new(0, 1);
    // The scene each patient was last published in (publish loop only): a move republishes the
    // old scene's list too, so the patient does not stay listed there.
    private readonly Dictionary<int, int> publishedScene = [];
    private bool overflowLogged;
    private IMqttClient? client;

    public bool Enabled => settings.Enabled;
    public bool IsConnected => client?.IsConnected ?? false;
    public int PendingCount
    {
        get
        {
            lock (gate) return pending.Count;
        }
    }

    /// <summary>Queues the patient's current state for publishing; never blocks.</summary>
    public void PatientChanged(int patientId)
    {
        if (!settings.Enabled) return;
        int? dropped = null;
        lock (gate)
        {
            if (!pendingIds.Add(patientId)) return;
            pending.AddLast(patientId);
            if (pending.Count > Math.Max(1, settings.PendingQueueCapacity))
            {
                dropped = pending.First!.Value;
                pending.RemoveFirst();
                pendingIds.Remove(dropped.Value);
            }
        }
        // Logged once per outage, not once per write.
        if (dropped is not null && !overflowLogged)
        {
            overflowLogged = true;
            logger.LogWarning("MQTT pending queue full ({Capacity}); the oldest patients are dropped until the broker is reachable", settings.PendingQueueCapacity);
        }
        try
        {
            wake.Release();
        }
        catch (SemaphoreFullException)
        {
            // Already signalled.
        }
    }

    private bool TryTake(out int patientId)
    {
        lock (gate)
        {
            patientId = 0;
            if (pending.First is null) return false;
            patientId = pending.First.Value;
            pending.RemoveFirst();
            pendingIds.Remove(patientId);
            return true;
        }
    }

    // Back to the front after a lost connection, unless a newer change queued it already.
    private void Requeue(int patientId)
    {
        lock (gate)
        {
            if (pendingIds.Add(patientId)) pending.AddFirst(patientId);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Enabled)
        {
            logger.LogInformation("MQTT publishing is disabled");
            return;
        }

        client = new MqttFactory().CreateMqttClient();
        var delay = TimeSpan.FromSeconds(5);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!client.IsConnected)
                {
                    await ConnectAsync(stoppingToken);
                    logger.LogInformation("MQTT connected to {Host}:{Port}", settings.BrokerHost, settings.BrokerPort);
                    delay = TimeSpan.FromSeconds(5);
                }

                // Wake for work, or every 30 s to notice a lost connection while idle.
                if (PendingCount == 0)
                    await wake.WaitAsync(TimeSpan.FromSeconds(Math.Max(1, settings.IdleCheckSeconds)), stoppingToken);
                // Take, publish; a patient whose publish lost the connection goes back to the front.
                // A failure while connected (data, not transport) is logged and dropped, as in the
                // PLS backend, so one bad entry cannot block the rest.
                while (client.IsConnected && TryTake(out var patientId))
                {
                    try
                    {
                        await PublishAsync(patientId, stoppingToken);
                    }
                    catch (Exception ex) when (client.IsConnected && !stoppingToken.IsCancellationRequested)
                    {
                        logger.LogError(ex, "Failed to publish MQTT state for patient {PatientId}; dropped", patientId);
                    }
                    catch
                    {
                        Requeue(patientId);
                        throw;
                    }
                }
                if (PendingCount == 0) overflowLogged = false;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "MQTT unavailable; retrying in {Delay}s ({Pending} pending)", delay.TotalSeconds, PendingCount);
                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 60));
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        try
        {
            if (client?.IsConnected == true) await client.DisconnectAsync(cancellationToken: cancellationToken);
        }
        catch (Exception ex)
        {
            // The connection can drop between the check and the call; shutdown goes on.
            logger.LogDebug(ex, "MQTT disconnect at shutdown failed");
        }
        client?.Dispose();
    }

    private async Task ConnectAsync(CancellationToken cancellationToken)
    {
        var builder = new MqttClientOptionsBuilder()
            .WithTcpServer(settings.BrokerHost, settings.BrokerPort)
            .WithClientId(settings.ClientId);
        if (!string.IsNullOrEmpty(settings.Username)) builder.WithCredentials(settings.Username, settings.Password);
        await client!.ConnectAsync(builder.Build(), cancellationToken);
    }

    private async Task PublishAsync(int patientId, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var patient = await db.Patients.AsNoTracking().FirstOrDefaultAsync(p => p.Id == patientId, cancellationToken);
        if (patient is null)
        {
            // Gone from the database: an empty retained message removes its state from the broker.
            await client!.PublishAsync(new MqttApplicationMessageBuilder().WithTopic($"pls/v1/patients/{patientId}")
                .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce).WithRetainFlag(true).Build(), cancellationToken);
            if (publishedScene.Remove(patientId, out var lastScene)) await PublishSceneAsync(db, lastScene, DateTime.UtcNow, cancellationToken);
            return;
        }
        var bodyJson = await db.Bodies.AsNoTracking().Where(b => b.PatientId == patientId).Select(b => b.BodyPartsJson).FirstOrDefaultAsync(cancellationToken);
        var now = DateTime.UtcNow;

        var payload = new Dictionary<string, object?>
        {
            ["schemaVersion"] = 1,
            ["eventTimestamp"] = now,
            ["patientId"] = patient.Id,
            ["triagefarbe"] = PlsTriageColor(patient.Triagefarbe),
            ["atmung"] = patient.Atmung,
            ["blutung"] = patient.Blutung,
            ["radialispuls"] = patient.Radialispuls,
            ["transport"] = patient.Transport,
            ["dringend"] = patient.Dringend,
            ["kontaminiert"] = patient.Kontaminiert,
        };
        if (!settings.RedactName && !redactPersonalData) payload["name"] = patient.Name;
        if (!settings.RedactLocation && !redactPersonalData)
        {
            payload["longitude"] = patient.LongitudePatient;
            payload["latitude"] = patient.LatitudePatient;
        }
        payload["bodyParts"] = bodyJson is null ? null : JsonSerializer.Deserialize<Dictionary<string, int>>(bodyJson);
        payload["operationSceneId"] = patient.OperationSceneId;

        await client!.PublishAsync(Message($"pls/v1/patients/{patient.Id}", payload), cancellationToken);

        await PublishSceneAsync(db, patient.OperationSceneId, now, cancellationToken);
        if (publishedScene.TryGetValue(patient.Id, out var previousScene) && previousScene != patient.OperationSceneId)
            await PublishSceneAsync(db, previousScene, now, cancellationToken);
        publishedScene[patient.Id] = patient.OperationSceneId;
        logger.LogDebug("Published MQTT state for patient {PatientId}", patient.Id);
    }

    private async Task PublishSceneAsync(AppDbContext db, int sceneId, DateTime now, CancellationToken cancellationToken)
    {
        var patientIds = await db.Patients.AsNoTracking().Where(p => p.OperationSceneId == sceneId).OrderBy(p => p.Id).Select(p => p.Id).ToListAsync(cancellationToken);
        await client!.PublishAsync(Message($"pls/v1/scenes/{sceneId}/patients", new { schemaVersion = 1, eventTimestamp = now, sceneId, patientIds }), cancellationToken);
    }

    private static MqttApplicationMessage Message(string topic, object payload) => new MqttApplicationMessageBuilder()
        .WithTopic(topic)
        .WithPayload(JsonSerializer.Serialize(payload))
        .WithQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)
        .WithRetainFlag(true)
        .Build();

    /// <summary>The PLS contract spells green "grün"; every other colour is the same word.</summary>
    public static string? PlsTriageColor(string? triagefarbe) => triagefarbe == "gruen" ? "grün" : triagefarbe;
}
