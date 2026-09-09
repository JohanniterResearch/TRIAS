using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Microsoft.AspNetCore.SignalR;

namespace Ambulanzsystem.Api.Realtime;

// Delivery stays decoupled from committed API writes. Each recipient gets a fresh context so
// an established WebSocket never turns its handshake authorization into permanent access.
public class RealtimeDispatcher(
    RealtimePublisher publisher,
    IHubContext<SceneHub> hub,
    SceneSubscriptions subscriptions,
    IServiceScopeFactory scopes,
    ILogger<RealtimeDispatcher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var message in publisher.Reader.ReadAllAsync(stoppingToken))
            {
                var healthy = true;
                foreach (var recipient in subscriptions.ForGroup(message.GroupName))
                {
                    try
                    {
                        await using var scope = scopes.CreateAsyncScope();
                        var sessions = scope.ServiceProvider.GetRequiredService<SessionValidator>();
                        if (await sessions.ValidateAsync(recipient.Principal) != SessionValidity.Valid)
                        {
                            subscriptions.Remove(recipient.ConnectionId);
                            continue;
                        }
                        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                        if (!await SceneAccess.CanAccessAsync(recipient.Principal, db, recipient.SceneId))
                        {
                            subscriptions.Remove(recipient.ConnectionId, recipient.SceneId);
                            continue;
                        }
                        await hub.Clients.Client(recipient.ConnectionId)
                            .SendAsync(message.MethodName, message.Payload, stoppingToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        healthy = false;
                        logger.LogWarning(ex, "Failed to authorize or dispatch realtime message {Method} to {Connection}",
                            message.MethodName, recipient.ConnectionId);
                    }
                }
                // A later successful recipient must not hide an earlier authorization DB failure.
                publisher.DispatcherHealthy = healthy;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            publisher.DispatcherHealthy = false;
            logger.LogCritical(ex, "Realtime dispatcher loop crashed — no further messages will be delivered until restart.");
        }
    }
}
