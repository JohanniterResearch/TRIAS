namespace Ambulanzsystem.Api.Config;

// Dev trusts localhost outright; prod reads PLS_ALLOWED_ORIGINS (comma-separated), already
// fail-fast validated as required in StartupValidation. No env var configured = no origins = deny-all.
public static class CorsPolicy
{
    public const string Name = "Ambulanzsystem";

    public static void AddAmbulanzsystemCors(this IServiceCollection services, IConfiguration config, IHostEnvironment env)
    {
        services.AddCors(options => options.AddPolicy(Name, policy =>
        {
            var origins = env.IsDevelopment()
                ? new[] { "http://localhost:4200" }
                : (config["PLS_ALLOWED_ORIGINS"] ?? string.Empty)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (origins.Length == 0)
            {
                return; // no allowed origins configured -> policy rejects every cross-origin request
            }

            policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
        }));
    }
}
