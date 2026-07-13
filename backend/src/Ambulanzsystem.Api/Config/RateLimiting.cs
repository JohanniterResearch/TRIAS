using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Ambulanzsystem.Api.Config;

// NFR-SEC-05: fixed window, 10 requests/60s per client IP, 429 on exceed.
public static class RateLimitPolicies
{
    public const string LoginPolicy = "login";

    public static void AddAmbulanzsystemRateLimiting(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

            options.AddPolicy(LoginPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromSeconds(60),
                        QueueLimit = 0,
                    }));
        });
    }
}
