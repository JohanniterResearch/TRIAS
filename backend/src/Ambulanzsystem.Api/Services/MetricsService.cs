using Ambulanzsystem.Api.Realtime;

namespace Ambulanzsystem.Api.Services;

// Singleton, in-process atomic counters (NFR-OPS: /api/metrics). Not persisted across
// restarts — intended for live operational visibility, not historical analytics.
public class MetricsService(RealtimePublisher realtime)
{
    private long _totalRequests;
    private long _authFailures;
    private long _dbErrors;

    public void IncrementTotalRequests() => Interlocked.Increment(ref _totalRequests);
    public void IncrementAuthFailures() => Interlocked.Increment(ref _authFailures);
    public void IncrementDbErrors() => Interlocked.Increment(ref _dbErrors);

    public object Snapshot() => new
    {
        totalRequests = Interlocked.Read(ref _totalRequests),
        authFailures = Interlocked.Read(ref _authFailures),
        dbErrors = Interlocked.Read(ref _dbErrors),
        realtimeConnected = realtime.DispatcherHealthy,
        realtimePendingQueue = realtime.PendingCount,
        realtimeDroppedMessages = realtime.DroppedCount,
    };
}
