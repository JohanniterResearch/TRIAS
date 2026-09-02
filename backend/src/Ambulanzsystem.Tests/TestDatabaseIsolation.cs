using System.Runtime.CompilerServices;
using Npgsql;

namespace Ambulanzsystem.Tests;

internal static class TestDatabaseIsolation
{
    private static readonly string DatabaseName = $"ambulanzsystem_test_{Environment.ProcessId}_{Guid.NewGuid():N}";

    internal static string MaintenanceConnectionString { get; private set; } = null!;
    internal static string TestConnectionString { get; private set; } = null!;

    [ModuleInitializer]
    internal static void Initialize()
    {
        var configured = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
            ?? "Host=localhost;Port=5434;Database=ambulanzsystem;Username=pls;Password=dev-only-password";
        var maintenance = new NpgsqlConnectionStringBuilder(configured)
        {
            Database = "postgres",
            Pooling = false,
        };
        MaintenanceConnectionString = maintenance.ConnectionString;
        TestConnectionString = new NpgsqlConnectionStringBuilder(configured)
        {
            Database = DatabaseName,
        }.ConnectionString;

        using (var connection = new NpgsqlConnection(MaintenanceConnectionString))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = $"CREATE DATABASE \"{DatabaseName}\"";
            command.ExecuteNonQuery();
        }

        Environment.SetEnvironmentVariable("ConnectionStrings__Default", TestConnectionString);
        AppDomain.CurrentDomain.ProcessExit += (_, _) => DropDatabase();
    }

    private static void DropDatabase()
    {
        try
        {
            NpgsqlConnection.ClearAllPools();
            using var connection = new NpgsqlConnection(MaintenanceConnectionString);
            connection.Open();
            using (var terminate = connection.CreateCommand())
            {
                terminate.CommandText = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @name";
                terminate.Parameters.AddWithValue("name", DatabaseName);
                terminate.ExecuteNonQuery();
            }
            using var drop = connection.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{DatabaseName}\"";
            drop.ExecuteNonQuery();
        }
        catch
        {
            // Best-effort process-exit cleanup. A randomly named leftover test database cannot
            // contaminate development or another test process and can be removed operationally.
        }
    }
}
