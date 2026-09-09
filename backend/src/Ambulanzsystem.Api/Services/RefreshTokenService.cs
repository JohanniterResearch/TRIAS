using System.Security.Cryptography;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Ambulanzsystem.Api.Services;

public record IssuedRefreshToken(string RawToken, RefreshToken Entity);

// 64 random bytes, base64-encoded, returned to the client once. Only the SHA-256 hash is ever
// persisted — a DB read/leak cannot be replayed as a valid refresh token (recreation spec
// deviation #1, fixing a known hardening gap in the legacy implementation).
public class RefreshTokenService(AppDbContext db, IOptions<JwtOptions> options)
{
    private readonly JwtOptions _options = options.Value;

    public Task<IssuedRefreshToken> IssueAsync(int userId)
    {
        var issued = Create(userId);
        db.RefreshTokens.Add(issued.Entity);
        return Task.FromResult(issued);
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

        if (existing is null || existing.IsRevoked || existing.ExpiresAt < now)
        {
            return null;
        }

        var ownsTransaction = db.Database.CurrentTransaction is null;
        await using var transaction = ownsTransaction ? await db.Database.BeginTransactionAsync() : null;
        var user = await RowLocks.UserAsync(db, existing.UserId);
        if (user is null || user.RevokedAt is not null
            || (user.AccountType == AccountType.Event && user.EventSceneId is null))
        {
            if (transaction is not null) await transaction.RollbackAsync();
            return null;
        }

        var claimed = await db.RefreshTokens
            .Where(t => t.Id == existing.Id && !t.IsRevoked && t.ExpiresAt >= now)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.IsRevoked, true));
        if (claimed != 1)
        {
            if (transaction is not null) await transaction.RollbackAsync();
            return null;
        }

        var issued = Create(existing.UserId);
        db.RefreshTokens.Add(issued.Entity);
        await db.SaveChangesAsync();
        if (transaction is not null) await transaction.CommitAsync();
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
            ExpiresAt = DateTime.UtcNow.AddDays(_options.RefreshTokenLifetimeDays),
            IsRevoked = false,
        });
    }
}
