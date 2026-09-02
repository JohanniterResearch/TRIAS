using System.Threading.Channels;

namespace Ambulanzsystem.Api.Realtime;

public record QueuedMessage(string GroupName, string MethodName, object Payload);

// Bounded, in-process, drop-oldest publish queue (recreation spec §2.5: capacity ~200). Publish()
// only ever enqueues — it never touches the network — so a triage-affecting API write can call it
// and return immediately regardless of hub/client health (NFR-SAFE-03). RealtimeDispatcher
// consumes the queue in the background and does the actual SignalR send.
//
// Capacity is enforced manually (evict-oldest-then-write) rather than via
// BoundedChannelOptions.FullMode=DropOldest, because that mode gives no way to observe/count a
// drop — and "dropping queued messages must be observable" is an explicit requirement.
public class RealtimePublisher
{
    private const int Capacity = 200;
    private readonly Channel<QueuedMessage> _channel = Channel.CreateUnbounded<QueuedMessage>();
    private long _dropped;

    public int PendingCount => _channel.Reader.CanCount ? _channel.Reader.Count : 0;
    public long DroppedCount => Interlocked.Read(ref _dropped);

    // Tracks the latest dispatch attempt as well as a crashed dispatcher loop. A subsequent
    // successful send recovers the flag; until then /health must not claim realtime is healthy.
    public bool DispatcherHealthy { get; set; } = true;

    public ChannelReader<QueuedMessage> Reader => _channel.Reader;

    public void Publish(string groupName, string methodName, object payload)
    {
        while (_channel.Reader.CanCount && _channel.Reader.Count >= Capacity && _channel.Reader.TryRead(out _))
        {
            Interlocked.Increment(ref _dropped);
        }

        _channel.Writer.TryWrite(new QueuedMessage(groupName, methodName, payload));
    }
}
