using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ambulanzsystem.Tests;

public class OperationalMetadataMigrationTests : IAsyncLifetime
{
    private const string PriorMigrationId = "20260825101448_ExternalStringDatabaseLimits";
    private readonly string _testDbName = $"operationalmetadatatest_{Guid.NewGuid():N}";

    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "test";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    public async Task InitializeAsync()
    {
        await using var conn = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"CREATE DATABASE \"{_testDbName}\"";
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearPool(new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = _testDbName }.ConnectionString));

        await using var conn = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
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
        var connectionString = new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString)
        {
            Database = _testDbName,
        }.ConnectionString;
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .Options);
    }

    private static IConfiguration Config(string deploymentId) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Bootstrap:AdminPassword"] = "a-real-production-password",
            ["BACKUP_EXPECTED_DEPLOYMENT_ID"] = deploymentId,
        })
        .Build();

    private static Task MigrateToAsync(AppDbContext db, string migrationId) =>
        db.GetInfrastructure().GetRequiredService<IMigrator>().MigrateAsync(migrationId);

    [Fact]
    public async Task FreshDatabase_HasExactlyTheImmutableOperatorDeploymentIdentityRequiredByBackupScripts()
    {
        await using var db = NewDbContext();
        await db.Database.MigrateAsync();
        await DataSeeder.SeedAsync(db, Config("operator-supplied-deployment"), new FakeEnv(Environments.Production));

        await using var conn = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = _testDbName }.ConnectionString);
        await conn.OpenAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT key, value FROM operational_metadata";
            await using var reader = await cmd.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal("deployment_id", reader.GetString(0));
            Assert.Equal("operator-supplied-deployment", reader.GetString(1));
            Assert.False(await reader.ReadAsync());
        }

        await using var update = conn.CreateCommand();
        update.CommandText = "UPDATE operational_metadata SET value = 'different' WHERE key = 'deployment_id'";
        await Assert.ThrowsAsync<PostgresException>(() => update.ExecuteNonQueryAsync());
    }

    // Compose maps BACKUP_EXPECTED_DEPLOYMENT_ID with a `${VAR:-}` default (see docker-compose.yml),
    // so an operator who forgot to export it gets an empty string inside the container, not a
    // missing key. Only null hits the `??=` fallback, so an unguarded empty value would seed an
    // unrecoverable "" deployment_id (the row is immutable — see the test above). Must fail loud.
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task ProductionWithBlankDeploymentId_ThrowsAndWritesNoRow(string blankDeploymentId)
    {
        await using var db = NewDbContext();
        await db.Database.MigrateAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DataSeeder.SeedAsync(db, Config(blankDeploymentId), new FakeEnv(Environments.Production)));

        await using var conn = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = _testDbName }.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM operational_metadata";
        Assert.Equal(0L, (long)(await cmd.ExecuteScalarAsync())!);
    }

    [Fact]
    public async Task ExistingDeployment_MigratesForwardThenRejectsAChangedConfiguredIdentity()
    {
        await using var db = NewDbContext();
        await MigrateToAsync(db, PriorMigrationId);
        await db.Database.MigrateAsync();
        await DataSeeder.SeedAsync(db, Config("existing-deployment"), new FakeEnv(Environments.Production));

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            DataSeeder.SeedAsync(db, Config("changed-deployment"), new FakeEnv(Environments.Production)));
        Assert.Contains("BACKUP_EXPECTED_DEPLOYMENT_ID", ex.Message);

        await using var conn = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = _testDbName }.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT value FROM operational_metadata WHERE key = 'deployment_id'";
        Assert.Equal("existing-deployment", (string)(await cmd.ExecuteScalarAsync())!);
    }
}
