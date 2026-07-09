using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Endpoints;

// NFR-OPS-01. Realtime is stubbed "healthy" until the SignalR hub lands in B7.
public static class HealthEndpoint
{
    public static void MapHealthEndpoint(this WebApplication app)
    {
        app.MapGet("/health", async (AppDbContext db) =>
        {
            var dbHealthy = await CanConnectAsync(db);
            var status = dbHealthy ? "healthy" : "unhealthy";

            var body = new
            {
                status,
                database = dbHealthy ? "healthy" : "unhealthy",
                realtime = "healthy",
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
