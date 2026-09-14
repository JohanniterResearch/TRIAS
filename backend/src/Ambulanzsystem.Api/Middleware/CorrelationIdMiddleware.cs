namespace Ambulanzsystem.Api.Middleware;

// Echoes an inbound X-Correlation-Id or falls back to ASP.NET Core's own per-request
// TraceIdentifier, so every log line in a request can be tied back to one client-visible ID.
public static class CorrelationIdMiddleware
{
    private const string HeaderName = "X-Correlation-Id";

    public static IApplicationBuilder UseAmbulanzsystemCorrelationId(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            var correlationId = context.Request.Headers.TryGetValue(HeaderName, out var value) && value.Count > 0
                ? value.ToString()
                : context.TraceIdentifier;

            context.Response.Headers[HeaderName] = correlationId;

            var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
                .CreateLogger("CorrelationId");
            using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
            {
                await next();
            }
        });
    }
}
