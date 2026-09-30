using System.Security.Cryptography;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Services;

public record IssuedRefreshToken(string RawToken, RefreshToken Entity);

// 64 random bytes, base64-encoded, returned to the client once. Only the SHA-256 hash is ever
// persisted — a DB read/leak cannot be replayed as a valid refresh token (recreation spec
// deviation #1, fixing a known hardening gap in the legacy implementation).
public class RefreshTokenService(AppDbContext db, AuditService audit)
{
    // Two tabs of one browser can race the same refresh; only a later reuse counts as theft.
    private static readonly TimeSpan ReuseGrace = TimeSpan.FromSeconds(30);

    public IssuedRefreshToken Issue(int userId)
    {
        var issued = Create(userId);
        db.RefreshTokens.Add(issued.Entity);
        return issued;
    }

    // Rotation: the presented token is revoked and a new one issued, whether or not the caller
    // goes on to use the new one — a replayed old token is always rejected after first use.
    public async Task<(User User, IssuedRefreshToken NewToken)?> RotateAsync(string rawToken)
    {
        if (!TryHash(rawToken, out var hash)) return null;
        var now = DateTime.UtcNow;
        var existing = await db.RefreshTokens
            .AsNoTracking()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash);

        if (existing is null || existing.ExpiresAt < now)
        {
            return null;
        }
        if (existing.IsRevoked)
        {
            if (existing.RotatedAt is DateTime rotatedAt && now - rotatedAt > ReuseGrace)
            {
                await RevokeAfterReuseAsync(existing.UserId);
            }
            return null;
        }

        await using var transaction = await db.Database.BeginTransactionAsync();
        var user = await RowLocks.UserAsync(db, existing.UserId);
        if (user is null || user.RevokedAt is not null
            || (user.AccountType == AccountType.Event && user.EventSceneId is null))
        {
            await transaction.RollbackAsync();
            return null;
        }

        var claimed = await db.RefreshTokens
            .Where(t => t.Id == existing.Id && !t.IsRevoked && t.ExpiresAt >= now)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.IsRevoked, true).SetProperty(t => t.RotatedAt, now));
        if (claimed != 1)
        {
            await transaction.RollbackAsync();
            return null;
        }

        var issued = Create(existing.UserId);
        db.RefreshTokens.Add(issued.Entity);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (user, issued);
    }

    public async Task<bool> RevokeAsync(string rawToken)
    {
        if (!TryHash(rawToken, out var hash)) return false;
        var existing = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (existing is null) return false;

        existing.IsRevoked = true;
        await db.SaveChangesAsync();
        return true;
    }

    public async Task RevokeAllForUserAsync(int userId)
    {
        var activeTokens = await db.RefreshTokens
            .Where(t => t.UserId == userId && !t.IsRevoked)
            .ToListAsync();
        foreach (var token in activeTokens) token.IsRevoked = true;
    }

    // A rotated token came back: an attacker or the legitimate user holds a copy. End every session
    // of the account (refresh tokens and, via the security stamp, live access tokens) so both must
    // log in again, and record it.
    private async Task RevokeAfterReuseAsync(int userId)
    {
        await db.RefreshTokens.Where(t => t.UserId == userId && !t.IsRevoked)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.IsRevoked, true));
        await db.Users.Where(u => u.Id == userId)
            .ExecuteUpdateAsync(update => update.SetProperty(u => u.SecurityStamp, Guid.NewGuid().ToString()));
        audit.LogRevoke(null, "system", "refresh_token_reuse", userId);
        await db.SaveChangesAsync();
    }

    private static bool TryHash(string? raw, out string hash)
    {
        hash = string.Empty;
        if (string.IsNullOrWhiteSpace(raw) || raw.Length != 88) return false;

        Span<byte> decoded = stackalloc byte[64];
        if (!Convert.TryFromBase64String(raw, decoded, out var bytesWritten) || bytesWritten != decoded.Length)
        {
            return false;
        }

        hash = Convert.ToBase64String(SHA256.HashData(decoded));
        return true;
    }

    private IssuedRefreshToken Create(int userId)
    {
        var bytes = RandomNumberGenerator.GetBytes(64);
        var raw = Convert.ToBase64String(bytes);
        return new IssuedRefreshToken(raw, new RefreshToken
        {
            UserId = userId,
            TokenHash = Convert.ToBase64String(SHA256.HashData(bytes)),
            ExpiresAt = DateTime.UtcNow.AddDays(JwtOptions.RefreshTokenLifetimeDays),
            IsRevoked = false,
        });
    }
}
