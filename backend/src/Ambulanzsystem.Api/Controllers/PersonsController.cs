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

            await notifier.PatientUpdatedAsync(existing, false);
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
        await notifier.PatientUpdatedAsync(patient, true);
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

        await notifier.PatientUpdatedAsync(patient, true);
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

    // Every field is optional and null means "not sent": unlike Teams, nothing here is cleared to null.
    [HttpPost("persons/{id:int}/update-triage-color")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateTriageColor(int id, TriageUpdateRequest update)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();


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
        await notifier.PatientUpdatedAsync(patient, false);

        return Ok(PatientResponse.From(patient));
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
    public async Task<IActionResult> UpdateRespiration(int id, RespirationUpdateRequest request)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        if (merge.TryApply("atmung", request.ClientUpdatedAt, DateTime.UtcNow))
        {
            audit.LogFieldWrite(User, "patient", id, id, "atmung", patient.Atmung, request.Respiration);
            patient.Atmung = request.Respiration;
            patient.FieldTimestampsJson = merge.Save();
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await notifier.PatientUpdatedAsync(patient, false);
        return Ok(PatientResponse.From(patient));
    }

    [HttpPost("persons/{id:int}/location")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateLocation(int id, LocationRequest request)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        if (merge.TryApply("location", request.ClientUpdatedAt, DateTime.UtcNow))
        {
            var before = new { patient.LatitudePatient, patient.LongitudePatient };
            audit.LogFieldWrite(User, "patient", id, id, "location", before,
                new { lat = request.Lat, lng = request.Lng });

            patient.LatitudePatient = request.Lat;
            patient.LongitudePatient = request.Lng;
            patient.LocationSource = request.Source ?? "gps";
            patient.LocationAccuracyMeters = request.AccuracyMeters;
            patient.IndoorLocation = request.IndoorLocation;
            patient.LocationUpdatedAt = DateTime.UtcNow;
            patient.FieldTimestampsJson = merge.Save();
        }

        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await notifier.PatientUpdatedAsync(patient, false);
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
}
