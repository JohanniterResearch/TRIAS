using Ambulanzsystem.Api.Auth;

namespace Ambulanzsystem.Api.Config;

// NFR-OPS-04: startup shall fail on missing production secrets. Called before the app starts
// serving traffic — one place, checked once, instead of every consumer defending itself.
public static class StartupValidation
{
    public static void Validate(IConfiguration config, IHostEnvironment env)
    {
        var errors = new List<string>();

        var connectionString = config.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            errors.Add("ConnectionStrings:Default is required.");
        }

        var jwtSecret = config["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(jwtSecret) || jwtSecret.Length < 32)
        {
            errors.Add("Jwt:Secret is required and must be at least 32 characters.");
        }

        if (env.IsProduction())
        {
            if (!PasswordPolicy.IsValid(config["Bootstrap:AdminPassword"]))
            {
                errors.Add($"Bootstrap:AdminPassword is required in production and must be at least {PasswordPolicy.MinimumLength} characters.");
            }

            if (string.IsNullOrWhiteSpace(config["PLS_ALLOWED_ORIGINS"]))
            {
                errors.Add("PLS_ALLOWED_ORIGINS is required in production.");
            }

            if (string.IsNullOrWhiteSpace(config["BACKUP_EXPECTED_DEPLOYMENT_ID"]))
            {
                errors.Add("BACKUP_EXPECTED_DEPLOYMENT_ID is required in production.");
            }

            if (config.GetValue<bool>("Features:EnableDevLogin"))
            {
                errors.Add("Features:EnableDevLogin must not be true in production.");
            }
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                "Startup configuration is invalid:\n - " + string.Join("\n - ", errors));
        }
    }
}
