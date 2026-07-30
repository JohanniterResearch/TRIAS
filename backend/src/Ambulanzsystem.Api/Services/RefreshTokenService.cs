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

    public async Task<IssuedRefreshToken> IssueAsync(int userId)
    {
        var issued = Create(userId);
        db.RefreshTokens.Add(issued.Entity);
        await db.SaveChangesAsync();
        return issued;
    }

    // Rotation: the presented token is revoked and a new one issued, whether or not the caller
    // goes on to use the new one — a replayed old token is always rejected after first use.
    public async Task<(User User, IssuedRefreshToken NewToken)?> RotateAsync(string rawToken)
    {
        var hash = Hash(rawToken);
        var now = DateTime.UtcNow;
        var existing = await db.RefreshTokens
            .AsNoTracking()
            .Include(t => t.User)
            .FirstOrDefaultAsync(t => t.TokenHash == hash);

        if (existing is null || existing.IsRevoked || existing.ExpiresAt < now)
        {
            return null;
        }

        if (existing.User.RevokedAt is not null)
        {
            return null;
        }

        await using var transaction = await db.Database.BeginTransactionAsync();
        var claimed = await db.RefreshTokens
            .Where(t => t.Id == existing.Id && !t.IsRevoked && t.ExpiresAt >= now)
            .ExecuteUpdateAsync(update => update.SetProperty(t => t.IsRevoked, true));
        if (claimed != 1)
        {
            await transaction.RollbackAsync();
            return null;
        }

        var issued = Create(existing.UserId);
        db.RefreshTokens.Add(issued.Entity);
        await db.SaveChangesAsync();
        await transaction.CommitAsync();
        return (existing.User, issued);
    }

    public async Task<bool> RevokeAsync(string rawToken)
    {
        var hash = Hash(rawToken);
        var existing = await db.RefreshTokens.FirstOrDefaultAsync(t => t.TokenHash == hash);
        if (existing is null) return false;

        existing.IsRevoked = true;
        await db.SaveChangesAsync();
        return true;
    }

    public async Task RevokeAllForUserAsync(int userId)
    {
        await db.RefreshTokens
            .Where(t => t.UserId == userId && !t.IsRevoked)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.IsRevoked, true));
    }

    private static string Hash(string raw)
    {
        var bytes = SHA256.HashData(Convert.FromBase64String(raw));
        return Convert.ToBase64String(bytes);
    }

    private IssuedRefreshToken Create(int userId)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));
        return new IssuedRefreshToken(raw, new RefreshToken
        {
            UserId = userId,
            TokenHash = Hash(raw),
            ExpiresAt = DateTime.UtcNow.AddDays(_options.RefreshTokenLifetimeDays),
            IsRevoked = false,
        });
    }
}
