using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Data;

public static class DataSeeder
{
    // Runs on every startup; both halves are idempotent (guarded on "table is empty").
    public static async Task SeedAsync(AppDbContext db, IConfiguration config, IHostEnvironment env)
    {
        await SeedUsersAsync(db, config);

        if (env.IsDevelopment() && config.GetValue<bool>("Bootstrap:SeedDevSampleData"))
        {
            await SeedDevSampleDataAsync(db);
        }
    }

    private static async Task SeedUsersAsync(AppDbContext db, IConfiguration config)
    {
        if (await db.Users.AnyAsync()) return;

        var adminUsername = config["Bootstrap:AdminUsername"] ?? "admin";
        var adminPassword = config["Bootstrap:AdminPassword"];
        var testUsername = config["Bootstrap:TestUserUsername"] ?? "responder-demo";
        var testPassword = config["Bootstrap:TestUserPassword"] ?? "responder-demo";

        // Startup already fail-fasts in production when AdminPassword is unset (see StartupValidation);
        // this fallback only ever fires in dev/test where that check is skipped.
        adminPassword ??= "change-me-admin";

        db.Users.Add(new User
        {
            Username = adminUsername,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(adminPassword),
            Role = Role.Admin,
            AccountType = AccountType.Permanent,
            RequiresPasswordChange = true,
        });

        // No self-service password-change UI for non-admin roles yet — forcing a change here would
        // strand this account. Add that UI before flipping this to true.
        db.Users.Add(new User
        {
            Username = testUsername,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(testPassword),
            Role = Role.Responder,
            AccountType = AccountType.Permanent,
            RequiresPasswordChange = false,
        });

        await db.SaveChangesAsync();
    }

    private static async Task SeedDevSampleDataAsync(AppDbContext db)
    {
        // Idempotent: only seed when there are no scenes/patients yet. Transaction-guarded so two
        // instances racing on startup can't both insert (Bootstrap:SeedDevSampleData is dev-only).
        await using var tx = await db.Database.BeginTransactionAsync();

        if (await db.OperationScenes.AnyAsync() || await db.Patients.AnyAsync())
        {
            return;
        }

        var scene = new OperationScene
        {
            Name = "Demo-Event Wien",
            Description = "Seeded demo scene for local development.",
            Active = true,
        };
        db.OperationScenes.Add(scene);
        await db.SaveChangesAsync();

        (string color, double lat, double lng)[] demoPatients =
        [
            ("rot", 48.2082, 16.3738),
            ("gelb", 48.2100, 16.3700),
            ("gruen", 48.2050, 16.3750),
            ("schwarz", 48.2000, 16.3800),
        ];

        foreach (var (color, lat, lng) in demoPatients)
        {
            var patient = new Patient
            {
                OperationSceneId = scene.Id,
                Triagefarbe = color,
                LatitudePatient = lat,
                LongitudePatient = lng,
                LocationSource = "gps",
            };
            db.Patients.Add(patient);
            await db.SaveChangesAsync();

            db.Bodies.Add(new Body
            {
                PatientId = patient.Id,
                BodyPartsJson = BodyRegions.DefaultBodyPartsJson(),
            });
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
    }
}
