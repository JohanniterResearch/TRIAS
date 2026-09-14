using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Ambulanzsystem.Api.Auth;

namespace Ambulanzsystem.Api.Realtime;

public record SceneSubscription(string ConnectionId, ClaimsPrincipal Principal, int SceneId);

// In-memory, like SignalR connections themselves. Keep only claims required for live authorization.
public class SceneSubscriptions
{
    private readonly object _gate = new();
    private readonly Dictionary<string, (ClaimsPrincipal Principal, HashSet<int> Scenes)> _connections = [];

    public void Add(string connectionId, ClaimsPrincipal principal, int sceneId)
    {
        lock (_gate)
        {
            if (!_connections.TryGetValue(connectionId, out var connection))
            {
                var claims = principal.Claims.Where(c => c.Type is JwtRegisteredClaimNames.Sub or JwtRegisteredClaimNames.Exp or TokenTypes.ClaimType
                    or TokenTypes.SecurityStampClaimType or TokenTypes.SceneIdClaimType or TokenTypes.DevPasswordChangeBypassClaimType);
                connection = (new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer")), []);
                _connections.Add(connectionId, connection);
            }
            connection.Scenes.Add(sceneId);
        }
    }

    public SceneSubscription[] ForGroup(string groupName)
    {
        lock (_gate)
            return _connections.SelectMany(pair => pair.Value.Scenes
                .Where(sceneId => SceneHub.GroupName(sceneId) == groupName)
                .Select(sceneId => new SceneSubscription(pair.Key, pair.Value.Principal, sceneId))).ToArray();
    }

    public void Remove(string connectionId, int? sceneId = null)
    {
        lock (_gate)
        {
            if (sceneId is int scene && _connections.TryGetValue(connectionId, out var connection))
            {
                connection.Scenes.Remove(scene);
                if (connection.Scenes.Count > 0) return;
            }
            _connections.Remove(connectionId);
        }
    }
}
