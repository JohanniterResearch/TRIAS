using Microsoft.AspNetCore.SignalR;

namespace Ambulanzsystem.Api.Realtime;

// Background consumer for RealtimePublisher's queue. Runs for the lifetime of the app; a failed
// send (e.g. a transiently misbehaving client) is logged and never propagates anywhere that could
// affect an API request — this loop is fully decoupled from the request pipeline.
public class RealtimeDispatcher(
    RealtimePublisher publisher,
    IHubContext<SceneHub> hub,
    ILogger<RealtimeDispatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var message in publisher.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await hub.Clients.Group(message.GroupName).SendAsync(message.MethodName, message.Payload, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Failed to dispatch realtime message {Method} to {Group}", message.MethodName, message.GroupName);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            publisher.DispatcherHealthy = false;
            logger.LogCritical(ex, "Realtime dispatcher loop crashed — no further messages will be delivered until restart.");
        }
    }
}
