global using Xunit;

// Test classes share one physical Postgres database (see appsettings.Development.json) with no
// per-test transaction isolation; xUnit's default parallel collections raced migrations/seeded
// rows across hosts. Serializing here is the actual fix, not a workaround for a rare flake.
[assembly: CollectionBehavior(DisableTestParallelization = true)]