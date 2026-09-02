using System.ComponentModel.DataAnnotations;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record PatientResponse(
    int Id,
    string? HumanReadableId,
    Guid? ClientGeneratedId,
    string? Name,
    string? Triagefarbe,
    bool? Atmung,
    bool? Blutung,
    bool? Radialispuls,
    bool? Transport,
    bool? Dringend,
    bool? Kontaminiert,
    double? LongitudePatient,
    double? LatitudePatient,
    string? LocationSource,
    double? LocationAccuracyMeters,
    string? IndoorLocation,
    DateTime? LocationUpdatedAt,
    int OperationSceneId,
    bool QrCodeBound,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static PatientResponse From(Patient p) => new(
        p.Id, p.HumanReadableId, p.ClientGeneratedId, p.Name, p.Triagefarbe,
        p.Atmung, p.Blutung, p.Radialispuls, p.Transport, p.Dringend, p.Kontaminiert,
        p.LongitudePatient, p.LatitudePatient, p.LocationSource, p.LocationAccuracyMeters,
        p.IndoorLocation, p.LocationUpdatedAt, p.OperationSceneId, p.QrCodePatient != null,
        p.CreatedAt, p.UpdatedAt);
}

public record VerifyQrCodeRequest(string qr_code, int OperationSceneId);
public record VerifyQrResult(PatientResponse Patient, bool Created);

public record ManualPatientRequest(
    int OperationSceneId,
    [MaxLength(ExternalStringLimits.Name)] string? Name,
    Guid? ClientGeneratedId);

public record ReassignQrCodeRequest(string qr_code);

public record RespirationRequest(bool Respiration, DateTime? ClientUpdatedAt);

public record LocationRequest(
    double Lat,
    double Lng,
    string Source = "gps",
    double? AccuracyMeters = null,
    string? IndoorLocation = null,
    DateTime? ClientUpdatedAt = null);

public record TriageHistoryEntryResponse(
    DateTime Timestamp,
    int? ActorId,
    string ActorRole,
    string Field,
    string? Before,
    string? After);
