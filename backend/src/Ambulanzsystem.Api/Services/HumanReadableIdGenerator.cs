using System.Security.Cryptography;
using Ambulanzsystem.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Services;

// FR-PAT-07: short, memorable, human-readable, with no patient-identifying numbers/letters
// embedded (i.e. not derived from name/DOB/SSN — an adjective-animal pair plus a random
// two-digit tag is unrelated to the patient and easy to say over radio).
public static class HumanReadableIdGenerator
{
    private static readonly string[] Adjectives =
        ["Blauer", "Roter", "Gruener", "Stiller", "Schneller", "Ruhiger", "Heller", "Ferner"];

    private static readonly string[] Nouns =
        ["Falke", "Fuchs", "Baer", "Hirsch", "Adler", "Wolf", "Luchs", "Reiher"];

    public static async Task<string> GenerateUniqueAsync(AppDbContext db)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var candidate = $"{Pick(Adjectives)}-{Pick(Nouns)}-{RandomNumberGenerator.GetInt32(10, 100)}";
            if (!await db.Patients.AnyAsync(p => p.HumanReadableId == candidate))
            {
                return candidate;
            }
        }

        throw new InvalidOperationException("Could not generate a unique human-readable patient id.");
    }

    private static string Pick(string[] values) => values[RandomNumberGenerator.GetInt32(0, values.Length)];
}
