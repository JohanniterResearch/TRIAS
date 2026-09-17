using System.Text.Json;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record AdminUserPage(int Total, List<UserResponse> Items);
public record UpdateAdminUserRequest(string Username, Role Role, AccountType AccountType, int? EventSceneId);
public record ResetPasswordRequest(string TemporaryPassword);
public record AdminPatientPage(int Total, List<AdminPatientResponse> Items);
public record AdminPatientAuditEntry(DateTime Timestamp, string ActorRole, string Action, string EntityType, string[]? ChangedFields, string? Reason);
public record AdminProtocolResponse(string Status, JsonElement FormState, DateTime UpdatedAt, DateTime? FinalizedAt, List<string>? Warnings = null);
public record AdminPatientDetails(
    AdminPatientResponse Patient, Dictionary<string, int> BodyParts, AdminProtocolResponse Protocol,
    bool QrCodeBound, List<AdminPatientAuditEntry> AuditEntries);
public record AdminBodyPartsUpdate(Dictionary<string, int> BodyParts, string CorrectionReason);
public record AvailablePatientQrCode(string Reference, string Label, DateTime CreatedAt);
public record AvailablePatientQrCodePage(int Total, List<AvailablePatientQrCode> Items);
public record AssignAdminPatientQrCodeRequest(string Source, string? QrReference);
public record AssignAdminPatientQrCodeResponse(AdminPatientResponse Patient, string? PrintableQrToken);
public record AdminPatientResponse(
    string EditReference, string? HumanReadableId, string? Name, string? Triagefarbe,
    bool? Atmung, bool? Blutung, bool? Radialispuls, bool? Transport, bool? Dringend, bool? Kontaminiert,
    double? LongitudePatient, double? LatitudePatient, string? LocationSource, double? LocationAccuracyMeters,
    string? IndoorLocation, int OperationSceneId, string ProtocolStatus, DateTime CreatedAt, DateTime UpdatedAt)
{
    public static AdminPatientResponse From(Patient p, string? protocolStatus, string editReference) => new(
        editReference, p.HumanReadableId, p.Name, p.Triagefarbe, p.Atmung, p.Blutung, p.Radialispuls,
        p.Transport, p.Dringend, p.Kontaminiert, p.LongitudePatient, p.LatitudePatient,
        p.LocationSource, p.LocationAccuracyMeters, p.IndoorLocation, p.OperationSceneId,
        protocolStatus ?? "draft", p.CreatedAt, p.UpdatedAt);
}
