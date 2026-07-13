namespace Ambulanzsystem.Api.Services;

// D1 (record-only START) + D5 (ASCII canonical storage). One shared normalize helper so every
// write path (this endpoint today, dev-sample seeding, any future import) agrees on what's valid.
// 'blau' is deliberately excluded from V1 (FR-TRIAGE-06).
public static class TriageColors
{
    private static readonly HashSet<string> Valid = ["rot", "gelb", "gruen", "schwarz"];

    public static bool TryNormalize(string raw, out string normalized)
    {
        var s = raw.Trim().ToLowerInvariant();
        if (s == "grün") s = "gruen"; // D5: only this one known diacritic synonym is remapped.

        if (!Valid.Contains(s))
        {
            normalized = string.Empty;
            return false;
        }

        normalized = s;
        return true;
    }
}
