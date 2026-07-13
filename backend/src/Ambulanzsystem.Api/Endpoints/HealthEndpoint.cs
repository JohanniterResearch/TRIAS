using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Endpoints;

// NFR-OPS-01.
public static class HealthEndpoint
{
    public static void MapHealthEndpoint(this WebApplication app)
    {
        app.MapGet("/health", async (AppDbContext db, RealtimePublisher realtime) =>
        {
            var dbHealthy = await CanConnectAsync(db);
            var status = dbHealthy ? "healthy" : "unhealthy";

            // Degraded, not unhealthy: a non-empty queue at any snapshot instant is often just
            // transient dispatch lag under load, not an outage (contract/schemas/realtime-messages.md).
            var realtimeStatus = realtime.DispatcherHealthy && realtime.PendingCount == 0 ? "healthy" : "degraded";

            var body = new
            {
                status,
                database = dbHealthy ? "healthy" : "unhealthy",
                realtime = realtimeStatus,
            };

            return dbHealthy ? Results.Ok(body) : Results.Json(body, statusCode: 503);
        });
    }

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
