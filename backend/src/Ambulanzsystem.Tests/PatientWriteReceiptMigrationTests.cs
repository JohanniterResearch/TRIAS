using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ambulanzsystem.Tests;

public class PatientWriteReceiptMigrationTests
{
    [Fact]
    public async Task Upgrade_PreservesLegacyPatientAndLedger_WithoutInventingCreationReceipt()
    {
        var name = $"receipt_migration_{Guid.NewGuid():N}";
        var cs = new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = name }.ConnectionString;
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using (var create = connection.CreateCommand()) { create.CommandText = $"CREATE DATABASE \"{name}\""; await create.ExecuteNonQueryAsync(); }
        try
        {
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).UseSnakeCaseNamingConvention().Options);
            var migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
            await migrator.MigrateAsync("20261110142334_AddBodyPartWriteDecision");
            var patient = new Patient { Name = "legacy", ClientGeneratedId = Guid.NewGuid(), OperationScene = new OperationScene { Name = "migration" } };
            db.Patients.Add(patient); await db.SaveChangesAsync();
            db.Bodies.Add(new Body { PatientId = patient.Id, BodyPartsJson = BodyRegions.DefaultBodyPartsJson(), RegionTimestampsJson = "{}" });
            var key = Guid.NewGuid();
            db.BodyPartProcessedWrites.Add(new BodyPartProcessedWrite { PatientId = patient.Id, WriteId = key, Checksum = new string('A', 64), RejectedAsStale = true });
            await db.SaveChangesAsync();
            var createdAt = patient.CreatedAt;
            await migrator.MigrateAsync("20261111132316_AddPatientWriteReceipts");
            db.ChangeTracker.Clear();
            Assert.Empty(await db.PatientWriteReceipts.ToListAsync());
            var stored = await db.Patients.SingleAsync();
            Assert.Equal("legacy", stored.Name);
            Assert.Equal(createdAt.Ticks / 10, stored.CreatedAt.Ticks / 10);
            Assert.True((await db.BodyPartProcessedWrites.FindAsync(patient.Id, key))!.RejectedAsStale);
            Assert.Equal("{}", (await db.Bodies.SingleAsync()).RegionTimestampsJson);
        }
        finally
        {
            NpgsqlConnection.ClearPool(new NpgsqlConnection(cs));
            await using var drop = connection.CreateCommand(); drop.CommandText = $"DROP DATABASE \"{name}\" WITH (FORCE)"; await drop.ExecuteNonQueryAsync();
        }
    }
}
