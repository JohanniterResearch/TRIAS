using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Ambulanzsystem.Tests;

public class FieldWriteDecisionMigrationTests
{
    [Fact]
    public async Task Upgrade_PreservesReceiptsAndUnknownDecisions()
    {
        var name = $"field_decisions_{Guid.NewGuid():N}";
        var cs = new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString) { Database = name }.ConnectionString;
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using (var create = connection.CreateCommand()) { create.CommandText = $"CREATE DATABASE \"{name}\""; await create.ExecuteNonQueryAsync(); }
        try
        {
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).UseSnakeCaseNamingConvention().Options);
            var migrator = db.GetInfrastructure().GetRequiredService<IMigrator>();
            await migrator.MigrateAsync("20261111132316_AddPatientWriteReceipts");
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO operation_scenes(id,name,active,created_at,updated_at) VALUES(9000,'legacy',true,now(),now());
                INSERT INTO patients(id,name,operation_scene_id,field_timestamps,created_at,updated_at) VALUES(9000,'legacy',9000,'{{}}',now(),now());
                INSERT INTO triage_processed_writes(patient_id,write_id,checksum) VALUES(9000,'d6000000-0000-4000-8000-000000000001',repeat('A',64));
                INSERT INTO location_processed_writes(patient_id,write_id,checksum) VALUES(9000,'d6000000-0000-4000-8000-000000000001',repeat('B',64));
                INSERT INTO protokoll_processed_writes(patient_id,write_id,checksum) VALUES(9000,'d6000000-0000-4000-8000-000000000001',repeat('C',64));
                INSERT INTO audit_logs(timestamp,actor_role,action,entity_type,patient_id,"before","after") VALUES(now(),'admin','write','patient',9000,'false','true');
                """);
            await migrator.MigrateAsync();
            Assert.Null((await db.TriageProcessedWrites.SingleAsync()).DecisionsJson);
            Assert.Null((await db.LocationProcessedWrites.SingleAsync()).DecisionsJson);
            Assert.Null((await db.ProtokollProcessedWrites.SingleAsync()).DecisionsJson);
            Assert.Equal(new string('A',64), (await db.TriageProcessedWrites.SingleAsync()).Checksum);
            Assert.Equal(new string('B',64), (await db.LocationProcessedWrites.SingleAsync()).Checksum);
            Assert.Equal(new string('C',64), (await db.ProtokollProcessedWrites.SingleAsync()).Checksum);
            Assert.Equal("{}", (await db.Patients.SingleAsync()).FieldTimestampsJson);
            var audit = await db.AuditLogs.SingleAsync();
            Assert.Null(audit.WriteDetailsJson);
            Assert.Equal("false", audit.BeforeJson);
            Assert.Equal("true", audit.AfterJson);
        }
        finally
        {
            NpgsqlConnection.ClearPool(new NpgsqlConnection(cs));
            await using var drop = connection.CreateCommand(); drop.CommandText = $"DROP DATABASE \"{name}\" WITH (FORCE)"; await drop.ExecuteNonQueryAsync();
        }
    }
}
