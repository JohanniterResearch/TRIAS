using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Ambulanzsystem.Api.Middleware;

// Two jobs in one small middleware rather than two: count every request, and turn an unhandled
// DB exception into a clean 500 + a metrics bump instead of leaking a stack trace to the client.
public class MetricsMiddleware(RequestDelegate next, ILogger<MetricsMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context, Services.MetricsService metrics)
    {
        metrics.IncrementTotalRequests();

        try
        {
            await next(context);
        }
        catch (Exception ex) when (ex is DbUpdateException or PostgresException or NpgsqlException)
        {
            metrics.IncrementDbErrors();
            logger.LogError(ex, "Database error handling {Method} {Path}", context.Request.Method, context.Request.Path);

            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(new { status = "error", message = "A database error occurred." });
            }
        }
    }
}
