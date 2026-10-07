using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
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


// Disallow matches the contract's additionalProperties: false. JsonRequired stops a missing
// value-type field from silently binding as false/0.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record TriageUpdateRequest(
    string? TriageColor,
    bool? Respiration,
    bool? Blutung,
    bool? Radialispuls,
    bool? Transport,
    bool? Dringend,
    bool? Kontaminiert,
    DateTime? ClientUpdatedAt);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record RespirationUpdateRequest([property: JsonRequired] bool Respiration, DateTime? ClientUpdatedAt);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public record LocationRequest(
    [property: JsonRequired][Range(-90.0, 90.0)] double Lat,
    [property: JsonRequired][Range(-180.0, 180.0)] double Lng,
    [AllowedValues("gps", "manual", null)] string? Source,
    [Range(0.0, double.MaxValue)] double? AccuracyMeters,
    [MaxLength(ExternalStringLimits.ShortText)] string? IndoorLocation,
    DateTime? ClientUpdatedAt);

public record TriageHistoryEntryResponse(
    DateTime Timestamp,
    int? ActorId,
    string ActorRole,
    string Field,
    string? Before,
    string? After);
