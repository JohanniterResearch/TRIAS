using System.Threading.RateLimiting;
using Ambulanzsystem.Api.Dtos;
using Microsoft.AspNetCore.RateLimiting;

namespace Ambulanzsystem.Api.Config;

// NFR-SEC-05: fixed window, 10 requests/60s per client IP, 429 on exceed. The limits are
// configurable (RateLimiting:LoginPermitLimit / RefreshPermitLimit) because every device behind
// one venue NAT or LTE router shares a single client IP at shift start.
public static class RateLimitPolicies
{
    public const string LoginPolicy = "login";
    public const string RefreshPolicy = "refresh";

    public static void AddAmbulanzsystemRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            // The framework's default rejection body is empty; OpenAPI's RateLimited response
            // promises the same Error shape (status=error, message) as other error responses.
            options.OnRejected = (context, cancellationToken) =>
            {
                context.HttpContext.Response.ContentType = "application/json";
                return new ValueTask(context.HttpContext.Response.WriteAsJsonAsync(
                    new ErrorResponse("Too many requests. Please try again later."),
                    cancellationToken));
            };

            options.AddPolicy(LoginPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = PermitLimit(httpContext, "LoginPermitLimit"),
                        Window = TimeSpan.FromSeconds(60),
                        QueueLimit = 0,
                    }));

            options.AddPolicy(RefreshPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = PermitLimit(httpContext, "RefreshPermitLimit"),
                        Window = TimeSpan.FromSeconds(60),
                        QueueLimit = 0,
                    }));
        });
    }

    private static int PermitLimit(HttpContext httpContext, string key) =>
        Math.Max(1, httpContext.RequestServices.GetRequiredService<IConfiguration>().GetValue($"RateLimiting:{key}", 10));
}
