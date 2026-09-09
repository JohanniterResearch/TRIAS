using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace Ambulanzsystem.Tests;

public class EventScopeMigrationTests : IAsyncLifetime
{
    private readonly string databaseName = $"event_scope_{Guid.NewGuid():N}";
    private string ConnectionString => new NpgsqlConnectionStringBuilder(TestDatabaseIsolation.MaintenanceConnectionString)
        { Database = databaseName }.ConnectionString;
    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"CREATE DATABASE \"{databaseName}\"", connection);
        await command.ExecuteNonQueryAsync();
    }
    public async Task DisposeAsync()
    {
        await using var connection = new NpgsqlConnection(TestDatabaseIsolation.MaintenanceConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand($"DROP DATABASE \"{databaseName}\" WITH (FORCE)", connection);
        await command.ExecuteNonQueryAsync();
    }
    private AppDbContext Db() => new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(ConnectionString)
        .UseSnakeCaseNamingConvention().Options);

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FreshAndUpgradedDatabase_PreserveAssignedAndOrphanedAccounts(bool upgrade)
    {
        await using var db = Db();
        if (upgrade)
            await db.GetInfrastructure().GetRequiredService<IMigrator>().MigrateAsync("20260826104412_AddOperationalMetadata");
        else
            await db.Database.MigrateAsync();
        var scene = new OperationScene { Name = "migration-event" };
        var assigned = new User { Username = "assigned", PasswordHash = "unused", AccountType = AccountType.Event, EventScene = scene };
        var revoked = new User { Username = "revoked", PasswordHash = "unused", AccountType = AccountType.Event,
            EventScene = scene, RevokedAt = DateTime.UtcNow };
        var orphan = new User { Username = "orphan", PasswordHash = "unused", AccountType = AccountType.Event };
        db.Users.AddRange(assigned, revoked, orphan);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        if (upgrade) await db.Database.MigrateAsync();
        var failure = await Assert.ThrowsAsync<PostgresException>(() => db.OperationScenes.Where(s => s.Id == scene.Id).ExecuteDeleteAsync());
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, failure.SqlState);
        Assert.Equal("fk_users_operation_scenes_event_scene_id", failure.ConstraintName);
        Assert.Equal(3, await db.Users.CountAsync());
        Assert.Equal(2, await db.Users.CountAsync(u => u.EventSceneId == scene.Id));
        Assert.True(await db.Users.AnyAsync(u => u.Id == orphan.Id && u.AccountType == AccountType.Event && u.EventSceneId == null));
        var empty = new OperationScene { Name = "empty" };
        db.OperationScenes.Add(empty);
        await db.SaveChangesAsync();
        Assert.Equal(1, await db.OperationScenes.Where(s => s.Id == empty.Id).ExecuteDeleteAsync());
    }
}
