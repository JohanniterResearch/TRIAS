using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ambulanzsystem.Tests;

// A separate disposable database: never roll back the application's or the shared test schema.
public class BodyRegionTimestampMigrationTests : IAsyncLifetime
{
    private const string PriorMigration = "20261101165012_AddLocationProcessedWrites";
    private const string TargetMigration = "20261109194913_AddBodyRegionTimestamps";
    private readonly string databaseName = $"bodyregion_migration_{Guid.NewGuid():N}";

    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE \"{databaseName}\"";
        await command.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    private AppDbContext NewDb() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseNpgsql(new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString)
            { Database = databaseName }.ConnectionString).UseSnakeCaseNamingConvention().Options);

    [Fact]
    public async Task Upgrade_PreservesLegacyMarkersTimesAndChecksums_WithUnknownRegionTimes()
    {
        await using var db = NewDb();
        var migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(PriorMigration);
        var scene = new OperationScene { Name = "legacy body map" };
        var patient = new Patient { OperationScene = scene };
        db.Patients.Add(patient);
        var legacyTime = new DateTime(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);
        await db.SaveChangesAsync();
        var parts = BodyRegions.DefaultBodyPartsJson();
        var values = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(parts)!;
        values["kopf_vorne"] = 1;
        parts = System.Text.Json.JsonSerializer.Serialize(values);
        // Raw insert because the current EF model already includes the new column.
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO bodies (patient_id, body_parts, created_at, updated_at) VALUES ({patient.Id}, {parts}::jsonb, {legacyTime}, {legacyTime})");
        var writeId = Guid.NewGuid();
        var checksum = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(new { Idpatient = patient.Id, BodyPartId = "kopf_vorne", IsClicked = true })));
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO body_part_processed_writes (patient_id, write_id, checksum) VALUES ({patient.Id}, {writeId}, {checksum})");

        await migrator.MigrateAsync(TargetMigration);
        db.ChangeTracker.Clear();
        var body = await db.Bodies.SingleAsync(b => b.PatientId == patient.Id);
        Assert.Equal(1, System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!["kopf_vorne"]);
        Assert.Equal(values, System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson));
        Assert.Equal("{}", body.RegionTimestampsJson);
        Assert.Equal(legacyTime, body.CreatedAt);
        Assert.Equal(legacyTime, body.UpdatedAt);
        // The current EF model also contains step 3's later decision column.
        var storedChecksum = await db.Database.SqlQuery<string>($"SELECT checksum AS \"Value\" FROM body_part_processed_writes WHERE patient_id = {patient.Id} AND write_id = {writeId}").SingleAsync();
        Assert.Equal(checksum, storedChecksum);
        Assert.Contains(TargetMigration, await db.Database.GetAppliedMigrationsAsync());
    }

    [Fact]
    public async Task DecisionUpgrade_PreservesHistoricalOrdersWithoutInventingAnOutcome()
    {
        await using var db = NewDb();
        var migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(TargetMigration);
        var patient = new Patient { OperationScene = new OperationScene { Name = "historical decision" } };
        db.Patients.Add(patient);
        await db.SaveChangesAsync();
        var writeId = Guid.NewGuid();
        var checksum = new string('A', 64);
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO body_part_processed_writes (patient_id, write_id, checksum) VALUES ({patient.Id}, {writeId}, {checksum})");
        await migrator.MigrateAsync("20261110142334_AddBodyPartWriteDecision");
        var order = (await db.BodyPartProcessedWrites.FindAsync(patient.Id, writeId))!;
        Assert.Null(order.RejectedAsStale);
        Assert.Equal(checksum, order.Checksum);
        order.RejectedAsStale = true;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        Assert.True((await db.BodyPartProcessedWrites.FindAsync(patient.Id, writeId))!.RejectedAsStale);
    }
}
