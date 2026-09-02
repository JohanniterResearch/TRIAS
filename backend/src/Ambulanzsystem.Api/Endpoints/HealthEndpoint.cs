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
            var health = Evaluate(dbHealthy, realtime.DispatcherHealthy, realtime.PendingCount);

            var body = new
            {
                status = health.Status,
                database = health.Database,
                realtime = health.Realtime,
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
