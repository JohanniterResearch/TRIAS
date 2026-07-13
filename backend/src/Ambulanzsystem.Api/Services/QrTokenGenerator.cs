using System.Security.Cryptography;

namespace Ambulanzsystem.Api.Services;

// Shared by login QR codes (B2) and patient QR codes (B4) — one place generating the
// "encode only a random token" values the contract requires (FR-QR-08).
public static class QrTokenGenerator
{
    public static string Generate() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant(); // 64 chars
}
