using Ambulanzsystem.Api.Filters;
using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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
    [PatientWrite("qr-intake")]
    public async Task<IActionResult> VerifyQrCode(VerifyQrCodeRequest request)
    {
        if (!await SceneAccess.CanAccessAsync(User, db, request.OperationSceneId)) return Forbid();


        var code = await db.QrCodePatients
            .FromSqlInterpolated($"SELECT * FROM qr_code_patients WHERE qr_token = {request.qr_code} FOR UPDATE")
            .FirstOrDefaultAsync();

        if (code is null)
        {
            return NotFound(new ErrorResponse("Unknown QR code."));
        }

        if (code.PatientId is int existingPatientId)
        {
            var existing = await db.Patients.Include(p => p.QrCodePatient).FirstAsync(p => p.Id == existingPatientId);
            if (!await SceneAccess.CanAccessAsync(User, db, existing.OperationSceneId))
            {
                return Forbid();
            }

            var previousScene = existing.OperationSceneId;
            existing.OperationSceneId = request.OperationSceneId;
            code.OperationSceneId = request.OperationSceneId;
            audit.LogFieldWrite(User, "patient", existing.Id, existing.Id, "operationSceneId", previousScene, request.OperationSceneId);
            await db.SaveChangesAsync();

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

        patient.QrCodePatient = code;
        await notifier.PatientUpdatedAsync(patient, true);
        await PublishScenePatientListAsync(request.OperationSceneId);

        return StatusCode(201, new VerifyQrResult(PatientResponse.From(patient), true));
    }

    [HttpPost("persons/manual")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [PatientWrite("manual")]
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

        // PatientWriteFilter owns the transaction and scoped creation lock.
        db.Patients.Add(patient);
        await db.SaveChangesAsync();

        db.Bodies.Add(new Body { PatientId = patient.Id, BodyPartsJson = BodyRegions.DefaultBodyPartsJson() });
        audit.LogFieldWrite(User, "patient", patient.Id, patient.Id, "created", null, "manual");
        await db.SaveChangesAsync();

        await notifier.PatientUpdatedAsync(patient, true);
        await PublishScenePatientListAsync(patient.OperationSceneId);

        return StatusCode(201, PatientResponse.From(patient));
    }

    [HttpPost("persons/{id:int}/reassign-qr-code")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [PatientWrite("qr-reassign")]
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
        Guid? writeId = null;
        if (Request.Headers.TryGetValue("Idempotency-Key", out var key))
        {
            if (key.Count != 1 || key[0]?.Length != 36 ||
                !Guid.TryParseExact(key[0], "D", out var parsed) || parsed == Guid.Empty)
            {
                return BadRequest(new ErrorResponse("Idempotency-Key must be a non-empty UUID in hyphenated format."));
            }
            writeId = parsed;
        }

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        TriageProcessedWrite? receipt = null;
        var decisions = new FieldWriteDecisions(writeId);
        if (writeId is Guid keyId)
        {
            // Hash the bound order, including its original timestamp, before normalization/merge.
            var checksumOptions = new JsonSerializerOptions
            {
                DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            };
            var checksum = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(update, checksumOptions)));
            var processed = await db.TriageProcessedWrites.FindAsync(id, keyId);
            if (processed is not null)
            {
                if (processed.Checksum != checksum)
                    return Conflict(new ErrorResponse("Idempotency-Key was already used for a different triage order."));
                return Ok(PatientResponse.From(patient) with { FieldResults = FieldWriteDecisions.PatientResults(processed.DecisionsJson, patient) });
            }
            // Committed with the patient and audit; the patient lock serializes parallel replays.
            db.TriageProcessedWrites.Add(receipt = new TriageProcessedWrite
            {
                PatientId = id, WriteId = keyId, Checksum = checksum,
            });
        }

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        var now = DateTime.UtcNow;

        if (update.TriageColor is not null)
        {
            if (!TriageColors.TryNormalize(update.TriageColor, out var normalized))
            {
                return BadRequest(new ErrorResponse("triageColor must be one of rot, gelb, gruen, schwarz."));
            }

            if (decisions.Apply(merge, "triagefarbe", patient.Triagefarbe, normalized, update.ClientUpdatedAt, now))
            {
                patient.Triagefarbe = normalized;
            }
            var detail = decisions.Details[^1];
            audit.LogFieldWrite(User, "patient", id, id, "triagefarbe", detail.StoredValue, detail.ResultValue, detail);
        }

        ApplyOptionalBool(update.Respiration, decisions, merge, update.ClientUpdatedAt, now, "atmung", patient, id,
            () => patient.Atmung, v => patient.Atmung = v);
        ApplyOptionalBool(update.Blutung, decisions, merge, update.ClientUpdatedAt, now, "blutung", patient, id,
            () => patient.Blutung, v => patient.Blutung = v);
        ApplyOptionalBool(update.Radialispuls, decisions, merge, update.ClientUpdatedAt, now, "radialispuls", patient, id,
            () => patient.Radialispuls, v => patient.Radialispuls = v);
        ApplyOptionalBool(update.Transport, decisions, merge, update.ClientUpdatedAt, now, "transport", patient, id,
            () => patient.Transport, v => patient.Transport = v);
        ApplyOptionalBool(update.Dringend, decisions, merge, update.ClientUpdatedAt, now, "dringend", patient, id,
            () => patient.Dringend, v => patient.Dringend = v);
        ApplyOptionalBool(update.Kontaminiert, decisions, merge, update.ClientUpdatedAt, now, "kontaminiert", patient, id,
            () => patient.Kontaminiert, v => patient.Kontaminiert = v);

        if (receipt is not null) receipt.DecisionsJson = decisions.Save();
        patient.FieldTimestampsJson = merge.Save();
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await notifier.PatientUpdatedAsync(patient, false);

        return Ok(PatientResponse.From(patient) with { FieldResults = FieldWriteDecisions.PatientResults(decisions.Save(), patient) });
    }

    private async Task PublishScenePatientListAsync(int sceneId)
    {
        var ids = await db.Patients.Where(p => p.OperationSceneId == sceneId).Select(p => p.Id).ToListAsync();
        notifier.ScenePatientList(sceneId, ids);
    }

    private void ApplyOptionalBool(
        bool? value, FieldWriteDecisions decisions, FieldMerge merge, DateTime? clientUpdatedAt, DateTime now,
        string fieldName, Patient patient, int patientId, Func<bool?> getter, Action<bool?> setter)
    {
        if (value is null) return;
        var applied = decisions.Apply(merge, fieldName, getter(), value, clientUpdatedAt, now);
        var detail = decisions.Details[^1];
        audit.LogFieldWrite(User, "patient", patientId, patientId, fieldName, detail.StoredValue, detail.ResultValue, detail);
        if (applied) setter(value);
    }

    [HttpPost("persons/{id:int}/respiration")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    [PatientWrite("respiration")]
    public async Task<IActionResult> UpdateRespiration(int id, RespirationUpdateRequest request)
    {
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        Guid? writeId = Guid.TryParse(Request.Headers["Idempotency-Key"], out var parsed) ? parsed : null;
        var decisions = new FieldWriteDecisions(writeId);
        if (decisions.Apply(merge, "atmung", patient.Atmung, request.Respiration, request.ClientUpdatedAt, DateTime.UtcNow))
        {
            patient.Atmung = request.Respiration;
            patient.FieldTimestampsJson = merge.Save();
        }
        var detail = decisions.Details[^1];
        audit.LogFieldWrite(User, "patient", id, id, "atmung", detail.StoredValue, detail.ResultValue, detail);
        await db.SaveChangesAsync();
        await notifier.PatientUpdatedAsync(patient, false);
        return Ok(PatientResponse.From(patient) with { FieldResults = FieldWriteDecisions.PatientResults(decisions.Save(), patient) });
    }

    [HttpPost("persons/{id:int}/location")]
    [Authorize(Policy = AuthPolicies.TriageWrite)]
    public async Task<IActionResult> UpdateLocation(int id, LocationRequest request)
    {
        Guid? writeId = null;
        if (Request.Headers.TryGetValue("Idempotency-Key", out var key))
        {
            if (key.Count != 1 || key[0]?.Length != 36 ||
                !Guid.TryParseExact(key[0], "D", out var parsed) || parsed == Guid.Empty)
            {
                return BadRequest(new ErrorResponse("Idempotency-Key must be a non-empty UUID in hyphenated format."));
            }
            writeId = parsed;
        }

        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, id);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        LocationProcessedWrite? receipt = null;
        var decisions = new FieldWriteDecisions(writeId);
        if (writeId is Guid keyId)
        {
            // Hash the bound order, including its original timestamp, before the field merge.
            var checksum = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(request)));
            var processed = await db.LocationProcessedWrites.FindAsync(id, keyId);
            if (processed is not null)
            {
                if (processed.Checksum != checksum)
                    return Conflict(new ErrorResponse("Idempotency-Key was already used for a different location order."));
                return Ok(PatientResponse.From(patient) with { FieldResults = FieldWriteDecisions.PatientResults(processed.DecisionsJson, patient) });
            }
            // Committed with the patient and audit; the patient lock serializes parallel replays.
            db.LocationProcessedWrites.Add(receipt = new LocationProcessedWrite
            {
                PatientId = id, WriteId = keyId, Checksum = checksum,
            });
        }

        var merge = FieldMerge.Load(patient.FieldTimestampsJson);
        var requested = new { lat = (double?)request.Lat, lng = (double?)request.Lng, source = request.Source ?? "gps", accuracyMeters = request.AccuracyMeters, indoorLocation = request.IndoorLocation };
        if (decisions.Apply(merge, "location", FieldWriteDecisions.Location(patient), requested, request.ClientUpdatedAt, DateTime.UtcNow))
        {

            patient.LatitudePatient = request.Lat;
            patient.LongitudePatient = request.Lng;
            patient.LocationSource = request.Source ?? "gps";
            patient.LocationAccuracyMeters = request.AccuracyMeters;
            patient.IndoorLocation = request.IndoorLocation;
            patient.LocationUpdatedAt = DateTime.UtcNow;
            patient.FieldTimestampsJson = merge.Save();
        }

        var detail = decisions.Details[^1];
        audit.LogFieldWrite(User, "patient", id, id, "location", detail.StoredValue, detail.ResultValue, detail);
        if (receipt is not null) receipt.DecisionsJson = decisions.Save();
        await db.SaveChangesAsync();
        await tx.CommitAsync();
        await notifier.PatientUpdatedAsync(patient, false);
        return Ok(PatientResponse.From(patient) with { FieldResults = FieldWriteDecisions.PatientResults(decisions.Save(), patient) });
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
