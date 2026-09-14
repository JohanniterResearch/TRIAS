using System.Data;
using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api")]
[Authorize]
public class PersonsController(AppDbContext db, AuditService audit, SceneNotifier notifier) : ControllerBase
{
    private static readonly HashSet<string> TriageUpdateFields =
    [
        "triageColor", "respiration", "blutung", "radialispuls", "transport", "dringend",
        "kontaminiert", "clientUpdatedAt"
    ];

    private static readonly HashSet<string> LocationFields =
    [
        "lat", "lng", "source", "accuracyMeters", "indoorLocation", "clientUpdatedAt"
    ];

    private static readonly HashSet<string> RespirationFields = ["respiration", "clientUpdatedAt"];

    [HttpGet("persons")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [AuditRead("patient_list", AuditIdSource.Query, "operationSceneId")]
    public async Task<IActionResult> List([FromQuery] int operationSceneId)
    {
        if (!await SceneAccess.CanAccessAsync(User, db, operationSceneId)) return Forbid();

        var patients = await db.Patients
            .Include(p => p.QrCodePatient)
            .Where(p => p.OperationSceneId == operationSceneId)
            .OrderBy(p => p.CreatedAt)
            .ToListAsync();

        return Ok(patients.Select(PatientResponse.From));
    }

    // Concurrency-safe (FOR UPDATE row lock): two parallel scans of the same code must never
    // create two patients. See B4 verification for a parallel-request test proving this.
    [HttpPost("verify-patient-qr-code")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> VerifyQrCode(VerifyQrCodeRequest request)
    {
        if (!await SceneAccess.CanAccessAsync(User, db, request.OperationSceneId)) return Forbid();

        await using var tx = await db.Database.BeginTransactionAsync();

        var code = await db.QrCodePatients
            .FromSqlInterpolated($"SELECT * FROM qr_code_patients WHERE qr_token = {request.qr_code} FOR UPDATE")
            .FirstOrDefaultAsync();

        if (code is null)
        {
            await tx.RollbackAsync();
            return NotFound(new ErrorResponse("Unknown QR code."));
        }

        if (code.PatientId is int existingPatientId)
        {
            var existing = await db.Patients.Include(p => p.QrCodePatient).FirstAsync(p => p.Id == existingPatientId);
            if (!await SceneAccess.CanAccessAsync(User, db, existing.OperationSceneId))
            {
                await tx.RollbackAsync();
                return Forbid();
            }

            var previousScene = existing.OperationSceneId;
            existing.OperationSceneId = request.OperationSceneId;
            code.OperationSceneId = request.OperationSceneId;
            audit.LogFieldWrite(User, "patient", existing.Id, existing.Id, "operationSceneId", previousScene, request.OperationSceneId);
            await db.SaveChangesAsync();
            await tx.CommitAsync();

            await PublishPatientUpdatedAsync(existing, false);
            if (previousScene != request.OperationSceneId)
            {
                await PublishScenePatientListAsync(previousScene);
                await PublishScenePatientListAsync(request.OperationSceneId);
            }

            return Ok(new VerifyQrResult(PatientResponse.From(existing), false));
        }

        var patient = new Patient { OperationSceneId = request.OperationSceneId, UserIdUser = User.OwnerUserId() };
        db.Patients.Add(patient);
        await db.SaveChangesAsync(); // assigns patient.Id

        db.Bodies.Add(new Body { PatientId = patient.Id, BodyPartsJson = BodyRegions.DefaultBodyPartsJson() });
        code.PatientId = patient.Id;
        code.OperationSceneId = request.OperationSceneId;
        audit.LogFieldWrite(User, "patient", patient.Id, patient.Id, "created", null, "qr-scan");
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        patient.QrCodePatient = code;
        await PublishPatientUpdatedAsync(patient, true);
        await PublishScenePatientListAsync(request.OperationSceneId);

        return StatusCode(201, new VerifyQrResult(PatientResponse.From(patient), true));
    }

    [HttpPost("persons/manual")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> CreateManual(ManualPatientRequest request)
    {
        if (request.ClientGeneratedId is Guid cgid)
        {
            var existing = await db.Patients.FirstOrDefaultAsync(p => p.ClientGeneratedId == cgid);
            if (existing is not null)
            {
                if (!await SceneAccess.CanAccessAsync(User, db, existing.OperationSceneId)) return Forbid();
                return Ok(PatientResponse.From(existing)); // idempotent replay (D3)
            }
        }

        if (!await SceneAccess.CanAccessAsync(User, db, request.OperationSceneId)) return Forbid();

        var patient = new Patient
        {
            OperationSceneId = request.OperationSceneId,
            Name = request.Name,
            ClientGeneratedId = request.ClientGeneratedId,
            HumanReadableId = await HumanReadableIdGenerator.GenerateUniqueAsync(db),
            UserIdUser = User.OwnerUserId(),
        };

        // Patient + Body + audit row commit as one all-or-nothing unit (rebuild spec transactional
        // requirement). The unique index on ClientGeneratedId is the concurrency authority for
        // offline replay (D3): if two devices race to replay the same client-generated id, the
        // loser's insert hits that constraint here rather than throwing past the caller — we
        // discard the failed tracked insert and return the winner's already-committed row instead.
        await using var tx = await db.Database.BeginTransactionAsync();

        db.Patients.Add(patient);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (request.ClientGeneratedId is not null && IsClientGeneratedIdConflict(ex))
        {
            await tx.RollbackAsync();
            db.Entry(patient).State = EntityState.Detached;

            var winner = await db.Patients.FirstAsync(p => p.ClientGeneratedId == request.ClientGeneratedId);
            if (!await SceneAccess.CanAccessAsync(User, db, winner.OperationSceneId)) return Forbid();
            return Ok(PatientResponse.From(winner));
        }

        db.Bodies.Add(new Body { PatientId = patient.Id, BodyPartsJson = BodyRegions.DefaultBodyPartsJson() });
        audit.LogFieldWrite(User, "patient", patient.Id, patient.Id, "created", null, "manual");
        await db.SaveChangesAsync();
        await tx.CommitAsync();

        await PublishPatientUpdatedAsync(patient, true);
        await PublishScenePatientListAsync(patient.OperationSceneId);

        return StatusCode(201, PatientResponse.From(patient));
    }

    // 23505 is postgres's unique-violation SQL state; the only unique constraint that can fire on
    // a fresh Patient insert is the ClientGeneratedId index (see AppDbContext), so any unique
    // violation here is by construction a concurrent replay of the same offline-generated id.
    private static bool IsClientGeneratedIdConflict(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    [HttpPost("persons/{id:int}/reassign-qr-code")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> ReassignQrCode(int id, ReassignQrCodeRequest request)
    {
        var patient = await db.Patients.Include(p => p.QrCodePatient).FirstOrDefaultAsync(p => p.Id == id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var newCode = await db.QrCodePatients.FirstOrDefaultAsync(c => c.QrToken == request.qr_code);
        if (newCode is null) return NotFound(new ErrorResponse("Unknown QR code."));
        if (newCode.PatientId is not null) return Conflict(new ErrorResponse("QR code is already bound to another patient."));

        var oldToken = patient.QrCodePatient?.QrToken;
        if (patient.QrCodePatient is { } oldCode)
        {
            oldCode.PatientId = null;
        }

        newCode.PatientId = patient.Id;
        newCode.OperationSceneId = patient.OperationSceneId;
        audit.LogFieldWrite(User, "patient", patient.Id, patient.Id, "qr_code", oldToken, newCode.QrToken);
        await db.SaveChangesAsync();

        patient.QrCodePatient = newCode;
        return Ok(PatientResponse.From(patient));
    }

    // triageColor/respiration/blutung/... are all independently optional (contract) and, unlike
    // Team fields, are never meant to be explicitly cleared back to null via this endpoint — so a
    // raw JsonElement presence check (not a nullable-record DTO) is what tells "omitted" apart
    // from a JSON literal null, same fix class as the B2/B3 silent-default bugs.
    [HttpPost("persons/{id:int}/update-triage-color")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateTriageColor(int id, [FromBody] JsonElement body)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        if (!TryReadTriageUpdate(body, out var update, out var error))
        {
            return BadRequest(error);
        }

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        var now = DateTime.UtcNow;

        if (update.TriageColor is not null)
        {
            if (!TriageColors.TryNormalize(update.TriageColor, out var normalized))
            {
                return BadRequest(new ErrorResponse("triageColor must be one of rot, gelb, gruen, schwarz."));
            }

            if (merge.TryApply("triagefarbe", update.ClientUpdatedAt, now))
            {
                audit.LogFieldWrite(User, "patient", id, id, "triagefarbe", patient.Triagefarbe, normalized);
                patient.Triagefarbe = normalized;
            }
        }

        ApplyOptionalBool(update.Respiration, merge, update.ClientUpdatedAt, now, "atmung", patient, id,
            () => patient.Atmung, v => patient.Atmung = v);
        ApplyOptionalBool(update.Blutung, merge, update.ClientUpdatedAt, now, "blutung", patient, id,
            () => patient.Blutung, v => patient.Blutung = v);
        ApplyOptionalBool(update.Radialispuls, merge, update.ClientUpdatedAt, now, "radialispuls", patient, id,
            () => patient.Radialispuls, v => patient.Radialispuls = v);
        ApplyOptionalBool(update.Transport, merge, update.ClientUpdatedAt, now, "transport", patient, id,
            () => patient.Transport, v => patient.Transport = v);
        ApplyOptionalBool(update.Dringend, merge, update.ClientUpdatedAt, now, "dringend", patient, id,
            () => patient.Dringend, v => patient.Dringend = v);
        ApplyOptionalBool(update.Kontaminiert, merge, update.ClientUpdatedAt, now, "kontaminiert", patient, id,
            () => patient.Kontaminiert, v => patient.Kontaminiert = v);

        patient.FieldTimestampsJson = merge.Save();
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await PublishPatientUpdatedAsync(patient, false);

        return Ok(PatientResponse.From(patient));
    }

    private async Task PublishPatientUpdatedAsync(Patient patient, bool created)
    {
        var bodyPartsJson = await db.Bodies.Where(b => b.PatientId == patient.Id).Select(b => b.BodyPartsJson).FirstOrDefaultAsync();
        var bodyParts = bodyPartsJson is null ? [] : JsonSerializer.Deserialize<Dictionary<string, int>>(bodyPartsJson)!;
        var protokollStatus = await db.AmbulanzprotokollPage1s.Where(r => r.PatientId == patient.Id).Select(r => r.Status).FirstOrDefaultAsync();

        notifier.PatientUpdated(patient.OperationSceneId, PatientResponse.From(patient), bodyParts, created, protokollStatus);
    }

    private async Task PublishScenePatientListAsync(int sceneId)
    {
        var ids = await db.Patients.Where(p => p.OperationSceneId == sceneId).Select(p => p.Id).ToListAsync();
        notifier.ScenePatientList(sceneId, ids);
    }

    private void ApplyOptionalBool(
        bool? value, FieldMerge merge, DateTime? clientUpdatedAt, DateTime now,
        string fieldName, Patient patient, int patientId, Func<bool?> getter, Action<bool?> setter)
    {
        if (value is null) return;
        if (!merge.TryApply(fieldName, clientUpdatedAt, now)) return;

        audit.LogFieldWrite(User, "patient", patientId, patientId, fieldName, getter(), value);
        setter(value);
    }

    [HttpPost("persons/{id:int}/respiration")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateRespiration(int id, [FromBody] JsonElement body)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        if (body.ValueKind != JsonValueKind.Object || TryFindUnknownProperty(body, RespirationFields, out _))
        {
            return BadRequest(new ErrorResponse("respiration and optional clientUpdatedAt are the only accepted fields."));
        }
        if (!TryReadOptionalBool(body, "respiration", out var respiration, out var error) || respiration is null)
        {
            return BadRequest(error ?? new ErrorResponse("respiration is required."));
        }
        if (!TryReadClientUpdatedAt(body, out var clientUpdatedAt, out error))
        {
            return BadRequest(error);
        }

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        if (merge.TryApply("atmung", clientUpdatedAt, DateTime.UtcNow))
        {
            audit.LogFieldWrite(User, "patient", id, id, "atmung", patient.Atmung, respiration);
            patient.Atmung = respiration;
            patient.FieldTimestampsJson = merge.Save();
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await PublishPatientUpdatedAsync(patient, false);
        return Ok(PatientResponse.From(patient));
    }

    [HttpPost("persons/{id:int}/location")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateLocation(int id, [FromBody] JsonElement body)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        if (!TryReadLocation(body, out var request, out var error))
        {
            return BadRequest(error);
        }

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        if (merge.TryApply("location", request.ClientUpdatedAt, DateTime.UtcNow))
        {
            var before = new { patient.LatitudePatient, patient.LongitudePatient };
            audit.LogFieldWrite(User, "patient", id, id, "location", before,
                new { lat = request.Lat, lng = request.Lng });

            patient.LatitudePatient = request.Lat;
            patient.LongitudePatient = request.Lng;
            patient.LocationSource = request.Source;
            patient.LocationAccuracyMeters = request.AccuracyMeters;
            patient.IndoorLocation = request.IndoorLocation;
            patient.LocationUpdatedAt = DateTime.UtcNow;
            patient.FieldTimestampsJson = merge.Save();
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await PublishPatientUpdatedAsync(patient, false);
        return Ok(PatientResponse.From(patient));
    }

    [HttpGet("persons/{id:int}/triage-history")]
    [Authorize(Policy = AuthPolicies.LeitstelleOrAdmin)]
    [AuditRead("patient", AuditIdSource.Route, "id")]
    public async Task<IActionResult> TriageHistory(int id)
    {
        var patient = await db.Patients.FindAsync(id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var triageFields = new[] { "triagefarbe", "atmung", "blutung", "radialispuls", "transport", "dringend", "kontaminiert" };

        var entries = await db.AuditLogs
            .Where(a => a.PatientId == id && a.Action == "write")
            .OrderByDescending(a => a.Timestamp)
            .ToListAsync();

        var history = entries
            .Select(e => new { Entry = e, Field = JsonSerializer.Deserialize<string[]>(e.ChangedFieldsJson ?? "[]")!.FirstOrDefault() })
            .Where(x => x.Field is not null && triageFields.Contains(x.Field))
            .Select(x => new TriageHistoryEntryResponse(
                x.Entry.Timestamp, x.Entry.ActorId, x.Entry.ActorRole, x.Field!,
                x.Entry.BeforeJson, x.Entry.AfterJson))
            .ToList();

        return Ok(history);
    }

    private static bool TryReadTriageUpdate(JsonElement body, out TriageUpdateRequest request, out ErrorResponse error)
    {
        request = default;
        if (body.ValueKind != JsonValueKind.Object)
        {
            error = new ErrorResponse("triage update body must be a JSON object.");
            return false;
        }

        if (TryFindUnknownProperty(body, TriageUpdateFields, out var unknown))
        {
            error = new ErrorResponse($"Unknown triage field: {unknown}.");
            return false;
        }

        if (!TryReadClientUpdatedAt(body, out var clientUpdatedAt, out error))
        {
            return false;
        }

        if (!TryReadOptionalString(body, "triageColor", out var triageColor, out error)
            || !TryReadOptionalBool(body, "respiration", out var respiration, out error)
            || !TryReadOptionalBool(body, "blutung", out var blutung, out error)
            || !TryReadOptionalBool(body, "radialispuls", out var radialispuls, out error)
            || !TryReadOptionalBool(body, "transport", out var transport, out error)
            || !TryReadOptionalBool(body, "dringend", out var dringend, out error)
            || !TryReadOptionalBool(body, "kontaminiert", out var kontaminiert, out error))
        {
            return false;
        }

        request = new TriageUpdateRequest(triageColor, respiration, blutung, radialispuls, transport, dringend, kontaminiert, clientUpdatedAt);
        error = null!;
        return true;
    }

    private static bool TryReadLocation(JsonElement body, out LocationRequest request, out ErrorResponse error)
    {
        request = default!;
        if (body.ValueKind != JsonValueKind.Object)
        {
            error = new ErrorResponse("location body must be a JSON object.");
            return false;
        }

        if (TryFindUnknownProperty(body, LocationFields, out var unknown))
        {
            error = new ErrorResponse($"Unknown location field: {unknown}.");
            return false;
        }

        if (!TryReadRequiredDouble(body, "lat", -90, 90, out var lat, out error)
            || !TryReadRequiredDouble(body, "lng", -180, 180, out var lng, out error)
            || !TryReadOptionalNonNegativeFiniteDouble(body, "accuracyMeters", out var accuracyMeters, out error)
            || !TryReadOptionalString(body, "indoorLocation", out var indoorLocation, out error, ExternalStringLimits.ShortText)
            || !TryReadClientUpdatedAt(body, out var clientUpdatedAt, out error))
        {
            return false;
        }

        var source = "gps";
        if (body.TryGetProperty("source", out var sourceElement) && sourceElement.ValueKind != JsonValueKind.Null)
        {
            if (sourceElement.ValueKind != JsonValueKind.String)
            {
                error = new ErrorResponse("source must be gps or manual.");
                return false;
            }

            source = sourceElement.GetString() ?? "";
            if (source is not ("gps" or "manual"))
            {
                error = new ErrorResponse("source must be gps or manual.");
                return false;
            }
        }

        request = new LocationRequest(lat, lng, source, accuracyMeters, indoorLocation, clientUpdatedAt);
        error = null!;
        return true;
    }

    private static bool TryReadClientUpdatedAt(JsonElement body, out DateTime? clientUpdatedAt, out ErrorResponse error)
    {
        clientUpdatedAt = null;
        if (!body.TryGetProperty("clientUpdatedAt", out var element) || element.ValueKind == JsonValueKind.Null)
        {
            error = null!;
            return true;
        }

        if (element.ValueKind != JsonValueKind.String || !element.TryGetDateTime(out var parsed))
        {
            error = new ErrorResponse("clientUpdatedAt must be a valid timestamp.");
            return false;
        }

        if (parsed > DateTime.UtcNow.AddMinutes(5))
        {
            error = new ErrorResponse("clientUpdatedAt must not be more than 5 minutes in the future.");
            return false;
        }

        clientUpdatedAt = parsed;
        error = null!;
        return true;
    }

    private static bool TryReadOptionalString(
        JsonElement body,
        string propertyName,
        out string? value,
        out ErrorResponse error,
        int? maxLength = null)
    {
        value = null;
        if (!body.TryGetProperty(propertyName, out var element) || element.ValueKind == JsonValueKind.Null)
        {
            error = null!;
            return true;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            error = new ErrorResponse($"{propertyName} must be a string.");
            return false;
        }

        value = element.GetString();
        if (maxLength is int limit && value!.Length > limit)
        {
            error = new ErrorResponse($"{propertyName} must not exceed {limit} characters.");
            return false;
        }

        error = null!;
        return true;
    }

    private static bool TryReadOptionalBool(JsonElement body, string propertyName, out bool? value, out ErrorResponse error)
    {
        value = null;
        if (!body.TryGetProperty(propertyName, out var element) || element.ValueKind == JsonValueKind.Null)
        {
            error = null!;
            return true;
        }

        if (element.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            error = new ErrorResponse($"{propertyName} must be a boolean.");
            return false;
        }

        value = element.GetBoolean();
        error = null!;
        return true;
    }

    private static bool TryReadRequiredDouble(
        JsonElement body, string propertyName, double min, double max, out double value, out ErrorResponse error)
    {
        value = default;
        if (!body.TryGetProperty(propertyName, out var element) || element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out value))
        {
            error = new ErrorResponse($"{propertyName} must be a number.");
            return false;
        }

        if (double.IsNaN(value) || double.IsInfinity(value) || value < min || value > max)
        {
            error = new ErrorResponse($"{propertyName} is out of range.");
            return false;
        }

        error = null!;
        return true;
    }

    private static bool TryReadOptionalNonNegativeFiniteDouble(
        JsonElement body, string propertyName, out double? value, out ErrorResponse error)
    {
        value = null;
        if (!body.TryGetProperty(propertyName, out var element) || element.ValueKind == JsonValueKind.Null)
        {
            error = null!;
            return true;
        }

        if (element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out var parsed)
            || double.IsNaN(parsed) || double.IsInfinity(parsed) || parsed < 0)
        {
            error = new ErrorResponse($"{propertyName} must be a non-negative finite number.");
            return false;
        }

        value = parsed;
        error = null!;
        return true;
    }

    private static bool TryFindUnknownProperty(JsonElement body, HashSet<string> allowedProperties, out string propertyName)
    {
        foreach (var property in body.EnumerateObject())
        {
            if (!allowedProperties.Contains(property.Name))
            {
                propertyName = property.Name;
                return true;
            }
        }

        propertyName = "";
        return false;
    }

    private readonly record struct TriageUpdateRequest(
        string? TriageColor,
        bool? Respiration,
        bool? Blutung,
        bool? Radialispuls,
        bool? Transport,
        bool? Dringend,
        bool? Kontaminiert,
        DateTime? ClientUpdatedAt);
}
