using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Endpoints;

// NFR-OPS-01.
public static class HealthEndpoint
{
    public static void MapHealthEndpoint(this WebApplication app)
    {
        app.MapGet("/health", async (AppDbContext db, RealtimePublisher realtime, MqttPublishService mqtt) =>
        {
            var dbHealthy = await CanConnectAsync(db);
            var health = Evaluate(dbHealthy, realtime.DispatcherHealthy, realtime.PendingCount);
            // The MQTT feed is optional: a broker outage degrades, it never makes the API unhealthy.
            var mqttState = MqttState(mqtt.Enabled, mqtt.IsConnected);
            var status = health.Status == "healthy" && mqttState == "degraded" ? "degraded" : health.Status;

            var body = new
            {
                status,
                database = health.Database,
                realtime = health.Realtime,
                mqtt = mqttState,
            };

            return Results.Json(body, statusCode: health.StatusCode);
        });
    }

    public static (int StatusCode, string Status, string Database, string Realtime) Evaluate(
        bool databaseHealthy,
        bool dispatcherHealthy,
        int pendingCount)
    {
        var realtime = !dispatcherHealthy ? "unhealthy" : pendingCount > 0 ? "degraded" : "healthy";
        var status = !databaseHealthy || !dispatcherHealthy ? "unhealthy" : pendingCount > 0 ? "degraded" : "healthy";
        return (status == "unhealthy" ? 503 : 200, status, databaseHealthy ? "healthy" : "unhealthy", realtime);
    }

    // Degraded only while the broker is unreachable: a queue that is being sent is normal.
    public static string MqttState(bool enabled, bool connected) =>
        !enabled ? "disabled" : connected ? "healthy" : "degraded";

    private static async Task<bool> CanConnectAsync(AppDbContext db)
    {
        try
        {
            return await db.Database.CanConnectAsync();
        }
        catch
        {
            return false;
        }
    }
}
