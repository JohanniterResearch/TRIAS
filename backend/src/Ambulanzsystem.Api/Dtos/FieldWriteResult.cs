using System.Text.Json;

namespace Ambulanzsystem.Api.Dtos;

// Outcome describes the original order. ServerValue is refreshed on every response/replay.
public record FieldWriteResult(string Field, string Outcome, string? ConflictReason, JsonElement ServerValue);
