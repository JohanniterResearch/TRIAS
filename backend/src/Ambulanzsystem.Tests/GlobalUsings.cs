global using Xunit;

// One isolated PostgreSQL database is created per test process by TestDatabaseIsolation. Tests
// inside that process still share seeded rows, so keep them serial while allowing independent
// test processes and E2E runs to execute without contaminating each other or the development DB.
[assembly: CollectionBehavior(DisableTestParallelization = true)]