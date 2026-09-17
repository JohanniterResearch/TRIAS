using System.Text.Json;

namespace Ambulanzsystem.Api.Dtos;

public record UpsertProtokollRequest(string Status, JsonElement FormState, DateTime? ClientUpdatedAt, string? CorrectionReason = null);

public record ProtokollRecordResponse(
    int PatientId,
    string Status,
    JsonElement FormState,
    DateTime UpdatedAt,
    DateTime? FinalizedAt,
    List<string>? Warnings = null);

public record ProtokollExportMetadata(
    int PatientId,
    string? HumanReadableId,
    int OperationSceneId,
    string OperationSceneName,
    int EventSceneId,
    DateTime GeneratedAt,
    string Watermark,
    string SchemaVersion);

public record ProtokollExportResponse(ProtokollExportMetadata Metadata, ProtokollRecordResponse Protokoll);
