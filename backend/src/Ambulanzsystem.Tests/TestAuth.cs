using System.Net;
using System.Net.Http.Json;

namespace Ambulanzsystem.Tests;

// Shared helper: newly-seeded/created Admin and Leitstelle accounts now carry
// RequiresPasswordChange = true (forced-change gate), so every test that logs in as such an
// account must clear that flag before it can reach a normal endpoint. Changes the password back
// to the same value so callers keep using their hardcoded credentials, then re-authenticates for
// a token that isn't gated.
internal static class TestAuth
{
    private sealed record LoginResult(string? token, bool requiresPasswordChange = false);

    public static async Task<string> LoginAsync(HttpClient client, string endpoint, string username, string password)
    {
        var body = await PostLoginAsync(client, endpoint, username, password);

        if (!body.requiresPasswordChange)
        {
            return body.token!;
        }

        client.DefaultRequestHeaders.Authorization = new("Bearer", body.token);
        var change = await client.PostAsJsonAsync(
            "/api/users/change-password",
            new { username, password, newPassword = password });
        change.EnsureSuccessStatusCode();
        client.DefaultRequestHeaders.Authorization = null;

        return (await PostLoginAsync(client, endpoint, username, password)).token!;
    }

    // The login endpoints share one fixed-window rate limit bucket (NFR-SEC-05, 10 req/60s per
    // IP); several test classes already sit close to that budget, and this helper's own
    // login -> change-password -> re-login dance adds one more request per gated account. Retry
    // once on 429 instead of tightening the shared production limiter for test convenience.
    private static async Task<LoginResult> PostLoginAsync(HttpClient client, string endpoint, string username, string password)
    {
        for (var attempt = 0; ; attempt++)
        {
            var res = await client.PostAsJsonAsync(endpoint, new { username, password });
            if (res.StatusCode != HttpStatusCode.TooManyRequests || attempt >= 3)
            {
                res.EnsureSuccessStatusCode();
                return (await res.Content.ReadFromJsonAsync<LoginResult>())!;
            }

            await Task.Delay(TimeSpan.FromSeconds(61));
        }
    }
}
