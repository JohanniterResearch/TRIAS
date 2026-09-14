using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ambulanzsystem.Tests;

// Reproduces Task 1.1 (docs/remediationPlanContinued.md): applying ExternalStringDatabaseLimits
// against a database that still carries legacy oversize `text` values must abort with an
// actionable diagnostic rather than truncating data or surfacing a raw Postgres column-width
// error. Runs against its own throwaway database (created and dropped per test, same pattern as
// DataSeederTests) migrated only up to the migration immediately preceding the one under test, so
// each test controls exactly what "legacy" data exists at that schema version.
public class ExternalStringMigrationTests : IAsyncLifetime
{
    private const string PriorMigrationId = "20260825094626_NormalizeFieldTimestampLedgers";
    private const string TargetMigrationId = "20260825101448_ExternalStringDatabaseLimits";

    private static string MaintenanceConnectionString => TestDatabaseIsolation.MaintenanceConnectionString;

    private readonly string _testDbName = $"migrationtest_{Guid.NewGuid():N}";

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

    private static Task MigrateToAsync(AppDbContext db, string targetMigrationId) =>
        db.GetInfrastructure().GetRequiredService<IMigrator>().MigrateAsync(targetMigrationId);

    // Creates a scene/team/patient at the pre-migration schema (columns still `text`), then
    // overwrites the string columns with values that are one character over the limit each new
    // column will impose. EF handles FK wiring; the oversize values are planted with raw UPDATEs
    // so nothing about EF's compiled (post-migration) model can mask what actually lands in the column.
    private async Task<(int SceneId, int TeamId, int PatientId)> SeedLegacyRowsAsync(AppDbContext db)
    {
        var scene = new OperationScene { Name = "legacy-scene", Description = "d" };
        var team = new Team { Name = "legacy-team", OperationScene = scene };
        var patient = new Patient { OperationScene = scene };
        db.OperationScenes.Add(scene);
        db.Teams.Add(team);
        db.Patients.Add(patient);
        await db.SaveChangesAsync();

        await db.Database.ExecuteSqlRawAsync(
            "UPDATE teams SET status = repeat('s', 33), name = repeat('n', 256), " +
            "contact_info = repeat('c', 256), assigned_location = repeat('l', 256) WHERE id = {0}",
            team.Id);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE patients SET name = repeat('p', 256), location_source = repeat('o', 256), " +
            "indoor_location = repeat('i', 256), human_readable_id = repeat('h', 65) WHERE id = {0}",
            patient.Id);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE operation_scenes SET description = repeat('x', 2001) WHERE id = {0}",
            scene.Id);

        return (scene.Id, team.Id, patient.Id);
    }

    [Fact]
    public async Task ApplyingExternalStringLimits_WithLegacyOversizeData_FailsWithControlledDiagnostic()
    {
        await using var db = NewDbContext();
        await MigrateToAsync(db, PriorMigrationId);
        var (sceneId, teamId, patientId) = await SeedLegacyRowsAsync(db);

        var ex = await Assert.ThrowsAsync<PostgresException>(() => MigrateToAsync(db, TargetMigrationId));

        // A controlled abort, not an unhandled column-width error: our own SQLSTATE, and a
        // message that names every offending table/column and an affected row id (not just
        // the first one found) so an operator can act without re-running the migration nine times.
        Assert.Equal("P0001", ex.SqlState);
        Assert.Contains("teams.status", ex.Message);
        Assert.Contains("teams.name", ex.Message);
        Assert.Contains("teams.contact_info", ex.Message);
        Assert.Contains("teams.assigned_location", ex.Message);
        Assert.Contains("patients.name", ex.Message);
        Assert.Contains("patients.location_source", ex.Message);
        Assert.Contains("patients.indoor_location", ex.Message);
        Assert.Contains("patients.human_readable_id", ex.Message);
        Assert.Contains("operation_scenes.description", ex.Message);
        Assert.Contains(teamId.ToString(), ex.Message);
        Assert.Contains(patientId.ToString(), ex.Message);
        Assert.Contains(sceneId.ToString(), ex.Message);

        // No partial schema state: the failed migration must not be recorded as applied, and the
        // narrowed columns must still be the old, unconstrained `text` type.
        await using var verify = NewDbContext();
        var appliedMigrations = await verify.Database.GetAppliedMigrationsAsync();
        Assert.DoesNotContain(TargetMigrationId, appliedMigrations);

        await using var conn = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(MaintenanceConnectionString) { Database = _testDbName }.ConnectionString);
        await conn.OpenAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText =
                "SELECT data_type FROM information_schema.columns WHERE table_name = 'teams' AND column_name = 'status'";
            Assert.Equal("text", (string)(await cmd.ExecuteScalarAsync())!);
        }

        // No truncation of the legacy data: it must be byte-identical to what was planted, not
        // silently cut down to fit.
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT status, name, contact_info, assigned_location FROM teams WHERE id = @id";
            cmd.Parameters.AddWithValue("id", teamId);
            await using var reader = await cmd.ExecuteReaderAsync();
            Assert.True(await reader.ReadAsync());
            Assert.Equal(new string('s', 33), reader.GetString(0));
            Assert.Equal(new string('n', 256), reader.GetString(1));
            Assert.Equal(new string('c', 256), reader.GetString(2));
            Assert.Equal(new string('l', 256), reader.GetString(3));
        }
    }

    [Fact]
    public async Task ApplyingExternalStringLimits_WithBoundaryLengthData_Succeeds()
    {
        await using var db = NewDbContext();
        await MigrateToAsync(db, PriorMigrationId);

        // operation_scenes.name is already varchar(255) as of InitialCreate and is untouched by
        // this migration; carrying it at exactly 255 here proves an already-bounded column
        // doesn't trip the new preflight.
        var scene = new OperationScene { Name = new string('e', 255), Description = "d" };
        var team = new Team { Name = "boundary-team", OperationScene = scene };
        var patient = new Patient { OperationScene = scene };
        db.OperationScenes.Add(scene);
        db.Teams.Add(team);
        db.Patients.Add(patient);
        await db.SaveChangesAsync();

        await db.Database.ExecuteSqlRawAsync(
            "UPDATE teams SET status = repeat('s', 32), name = repeat('n', 255), " +
            "contact_info = repeat('c', 255), assigned_location = repeat('l', 255) WHERE id = {0}",
            team.Id);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE patients SET name = repeat('p', 255), location_source = repeat('o', 255), " +
            "indoor_location = repeat('i', 255), human_readable_id = repeat('h', 64) WHERE id = {0}",
            patient.Id);
        await db.Database.ExecuteSqlRawAsync(
            "UPDATE operation_scenes SET description = repeat('x', 2000) WHERE id = {0}",
            scene.Id);

        await MigrateToAsync(db, TargetMigrationId);

        await using var verify = NewDbContext();
        var appliedMigrations = await verify.Database.GetAppliedMigrationsAsync();
        Assert.Contains(TargetMigrationId, appliedMigrations);

        await using var conn = new NpgsqlConnection(
            new NpgsqlConnectionStringBuilder(MaintenanceConnectionString) { Database = _testDbName }.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText =
            "SELECT data_type, character_maximum_length FROM information_schema.columns " +
            "WHERE table_name = 'teams' AND column_name = 'status'";
        await using var reader = await cmd.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal("character varying", reader.GetString(0));
        Assert.Equal(32, reader.GetInt32(1));
    }
}
