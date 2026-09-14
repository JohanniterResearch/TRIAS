using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Npgsql;
using Xunit;

namespace Ambulanzsystem.Tests;

// Runs against the same dev docker-compose Postgres server as the other integration tests, but
// in its own throwaway database (created and dropped per test) rather than the shared
// `ambulanzsystem` database those tests use — DataSeeder.SeedUsersAsync is guarded on "Users
// table is empty", which the shared database never is once any other test has run.
// EnsureCreatedAsync (not MigrateAsync) is used to stand up the schema: it builds straight from
// the current model, so this test doesn't depend on the migration history table being usable in
// a schema other than the one it was authored against.
public class DataSeederTests : IAsyncLifetime
{
    private static string MaintenanceConnectionString => TestDatabaseIsolation.MaintenanceConnectionString;

    private readonly string _testDbName = $"seedtest_{Guid.NewGuid():N}";

    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "test";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.ToDictionary(v => v.Key, v => (string?)v.Value))
            .Build();

    public async Task InitializeAsync()
    {
        await using var conn = new NpgsqlConnection(MaintenanceConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"CREATE DATABASE \"{_testDbName}\"";
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        // Drop pooled connections to the test database first — Npgsql pools by connection
        // string, so a leftover idle connection would otherwise make DROP DATABASE fail with
        // "database is being accessed by other users".
        NpgsqlConnection.ClearPool(new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(MaintenanceConnectionString) { Database = _testDbName }.ConnectionString));

        await using var conn = new NpgsqlConnection(MaintenanceConnectionString);
        await conn.OpenAsync();

        await using (var terminate = conn.CreateCommand())
        {
            terminate.CommandText = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @name";
            terminate.Parameters.AddWithValue("name", _testDbName);
            await terminate.ExecuteNonQueryAsync();
        }

        await using var drop = conn.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS \"{_testDbName}\"";
        await drop.ExecuteNonQueryAsync();
    }

    private AppDbContext NewDbContext()
    {
        var csb = new NpgsqlConnectionStringBuilder(MaintenanceConnectionString) { Database = _testDbName };
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(csb.ConnectionString)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public async Task Production_SeedsOnlyBootstrapAdmin_NoDemoCredentials()
    {
        await using var db = NewDbContext();
        await db.Database.EnsureCreatedAsync();

        var config = Config(
            ("Bootstrap:AdminUsername", "admin"),
            ("Bootstrap:AdminPassword", "a-real-production-password"),
            ("BACKUP_EXPECTED_DEPLOYMENT_ID", "test-production-deployment"));

        await DataSeeder.SeedAsync(db, config, new FakeEnv(Environments.Production));

        var users = await db.Users.ToListAsync();
        var user = Assert.Single(users);
        Assert.Equal("admin", user.Username);
        Assert.Equal(Role.Admin, user.Role);
        Assert.True(user.RequiresPasswordChange);
        Assert.DoesNotContain(users, u => u.Username == "responder-demo");
    }

    [Fact]
    public async Task Production_WithDemoSeedingFlagSet_StillDoesNotSeedDemoUser()
    {
        // The demo-seeding flag alone must never be enough in Production — it's gated on
        // Development too (DataSeeder.SeedUsersAsync).
        await using var db = NewDbContext();
        await db.Database.EnsureCreatedAsync();

        var config = Config(
            ("Bootstrap:AdminPassword", "a-real-production-password"),
            ("Bootstrap:SeedDevSampleData", "true"),
            ("BACKUP_EXPECTED_DEPLOYMENT_ID", "test-production-deployment"));

        await DataSeeder.SeedAsync(db, config, new FakeEnv(Environments.Production));

        var users = await db.Users.ToListAsync();
        Assert.Single(users);
        Assert.DoesNotContain(users, u => u.Username == "responder-demo");
    }

    [Fact]
    public async Task Development_WithDemoSeedingEnabled_SeedsDemoResponderAccount()
    {
        await using var db = NewDbContext();
        await db.Database.EnsureCreatedAsync();

        var config = Config(
            ("Bootstrap:AdminPassword", "dev-admin-password"),
            ("Bootstrap:SeedDevSampleData", "true"));

        await DataSeeder.SeedAsync(db, config, new FakeEnv(Environments.Development));

        var users = await db.Users.ToListAsync();
        Assert.Equal(2, users.Count);
        var demo = users.Single(u => u.Username == "responder-demo");
        Assert.Equal(Role.Responder, demo.Role);
        Assert.False(demo.RequiresPasswordChange);
    }

    [Fact]
    public async Task Development_WithoutDemoSeedingFlag_DoesNotSeedDemoUser()
    {
        await using var db = NewDbContext();
        await db.Database.EnsureCreatedAsync();

        var config = Config(("Bootstrap:AdminPassword", "dev-admin-password"));

        await DataSeeder.SeedAsync(db, config, new FakeEnv(Environments.Development));

        var users = await db.Users.ToListAsync();
        Assert.Single(users);
        var deploymentId = await db.Database.SqlQuery<string>(
            $"SELECT value AS \"Value\" FROM operational_metadata WHERE key = 'deployment_id'").SingleAsync();
        Assert.Equal("development", deploymentId);
    }
}
