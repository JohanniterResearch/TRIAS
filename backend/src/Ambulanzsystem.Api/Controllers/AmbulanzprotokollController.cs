using System.Data;
using System.Text.Json;
using System.Text.Json.Nodes;
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
[Route("api/persons/{patientId:int}/ambulanzprotokoll-page1")]
[Authorize(Policy = AuthPolicies.TriageWrite)]
public class AmbulanzprotokollController(AppDbContext db, AuditService audit, SceneNotifier notifier) : ControllerBase
{
    [HttpGet]
    [AuditRead("patient", AuditIdSource.Route, "patientId")]
    public async Task<IActionResult> Get(int patientId)
    {
        var patient = await db.Patients.FindAsync(patientId);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        var record = await db.AmbulanzprotokollPage1s.FirstOrDefaultAsync(r => r.PatientId == patientId);

        var formStateJson = FormStateMerge.WithDefaults(record?.FormStateJson ?? "{}");
        var formState = JsonDocument.Parse(formStateJson).RootElement;

        return Ok(new ProtokollRecordResponse(
            patientId,
            record?.Status ?? "draft",
            formState,
            // An unsaved/default-shaped protocol has no server edit timestamp. UnixEpoch keeps a
            // real offline draft newer than this synthetic response after provisional-ID rekey.
            record?.UpdatedAt ?? DateTime.UnixEpoch,
            record?.FinalizedAt));
    }

    [HttpPut]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> Upsert(int patientId, UpsertProtokollRequest request)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        var patient = await RowLocks.PatientAsync(db, patientId);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();

        if (request.Status is not ("draft" or "finalized"))
        {
            return BadRequest(new ErrorResponse("status must be draft or finalized."));
        }

        if (request.ClientUpdatedAt is DateTime clientUpdatedAt && clientUpdatedAt > DateTime.UtcNow.AddMinutes(5))
        {
            return BadRequest(new ErrorResponse("clientUpdatedAt must not be more than 5 minutes in the future."));
        }

        if (!AmbulanzprotokollSchemaValidator.TryValidatePartial(request.FormState, out var partialError))
        {
            return BadRequest(new ErrorResponse(partialError!));
        }

        var record = await db.AmbulanzprotokollPage1s.FirstOrDefaultAsync(r => r.PatientId == patientId);
        var wasFinalized = record?.Status == "finalized";

        if (wasFinalized && !CanCorrectFinalized(patient))
        {
            return Forbid();
        }
        if (wasFinalized && (string.IsNullOrWhiteSpace(request.CorrectionReason) || request.CorrectionReason.Length > 500))
        {
            return BadRequest(new ErrorResponse("correctionReason must be 1 to 500 characters for finalized protocol corrections."));
        }

        record ??= new AmbulanzprotokollPage1 { PatientId = patientId };
        var isNew = record.Id == 0;

        var oldFormStateJson = FormStateMerge.WithDefaults(record.FormStateJson);

        var now = DateTime.UtcNow;
        try
        {
            var incoming = JsonNode.Parse(request.FormState.GetRawText()) ?? new JsonObject();
            var merge = FieldMerge.Load(record.FieldTimestampsJson);
            record.FormStateJson = FormStateMerge.Apply(record.FormStateJson, incoming, merge, request.ClientUpdatedAt, now);
            record.FieldTimestampsJson = merge.Save();
            record.FormStateJson = ApplyGcsAutoSum(record.FormStateJson);
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            // Structurally unsafe payload that cannot be stored without data corruption — one of
            // the few hard-rejection cases allowed even for draft saves (rebuild spec, Validation
            // Rules). A type-mismatched leaf (e.g. a string where a GCS field expects a number)
            // lands here rather than crashing the request.
            return BadRequest(new ErrorResponse("formState contains a value that doesn't match the expected field types."));
        }

        if (!AmbulanzprotokollSchemaValidator.TryValidateMerged(record.FormStateJson, out var mergedError))
        {
            return BadRequest(new ErrorResponse(mergedError!));
        }

        var oldStatus = record.Status;
        record.Status = request.Status;
        if (request.Status == "finalized")
        {
            record.FinalizedAt = now;
        }

        var warnings = request.Status == "finalized" ? BuildFinalizeWarnings(record.FormStateJson) : [];

        if (isNew)
        {
            db.AmbulanzprotokollPage1s.Add(record);
        }

        // D7 requirement 3: record the changed leaf paths of the formState tree (e.g.
        // "vitals.pulse": 80 -> 92), not just a generic status field. status is folded in as one
        // more leaf so a status-only save (no formState change) still produces a diff.
        var newFormStateJson = FormStateMerge.WithDefaults(record.FormStateJson);
        var diffs = JsonDiff.Leaves(oldFormStateJson, newFormStateJson);
        if (oldStatus != record.Status)
        {
            diffs["status"] = (oldStatus, record.Status);
        }
        audit.LogFieldsWrite(User, "ambulanzprotokoll", record.Id, patientId, diffs, wasFinalized ? request.CorrectionReason : null);

        await db.SaveChangesAsync();

        if (record.Status == "finalized")
        {
            var version = await db.AmbulanzprotokollRevisions.Where(r => r.PatientId == patientId).Select(r => (int?)r.Version).MaxAsync() ?? 0;
            db.AmbulanzprotokollRevisions.Add(new AmbulanzprotokollRevision
            {
                PatientId = patientId,
                Version = version + 1,
                FormStateSnapshotJson = FormStateMerge.WithDefaults(record.FormStateJson),
                FinalizedAt = record.FinalizedAt ?? now,
                ActorId = User.SubjectId(),
                ActorRole = User.TokenType() ?? "unknown",
                CorrectionReason = wasFinalized ? request.CorrectionReason : null,
            });
            await db.SaveChangesAsync();
        }
        await tx.CommitAsync();

        var bodyPartsJson = await db.Bodies.Where(b => b.PatientId == patientId).Select(b => b.BodyPartsJson).FirstOrDefaultAsync();
        var bodyParts = bodyPartsJson is null ? [] : JsonSerializer.Deserialize<Dictionary<string, int>>(bodyPartsJson)!;
        notifier.PatientUpdated(patient.OperationSceneId, PatientResponse.From(patient), bodyParts, false, record.Status);

        var formStateOut = JsonDocument.Parse(FormStateMerge.WithDefaults(record.FormStateJson)).RootElement;
        return Ok(new ProtokollRecordResponse(patientId, record.Status, formStateOut, record.UpdatedAt, record.FinalizedAt, warnings));
    }

    // JSON export (FR-DOC-09): persists an immutable archive snapshot (FR-DOC-14) and
    // audit-logs the export action, distinct from the live/mutable AmbulanzprotokollPage1 row.
    [HttpGet("export")]
    public async Task<IActionResult> Export(int patientId)
    {
        var patient = await db.Patients.Include(p => p.OperationScene).FirstOrDefaultAsync(p => p.Id == patientId);
        if (patient is null) return NotFound();
        if (!await SceneAccess.CanAccessAsync(User, db, patient.OperationSceneId)) return Forbid();
        if (!CanCorrectFinalized(patient)) return Forbid();

        var record = await db.AmbulanzprotokollPage1s.FirstOrDefaultAsync(r => r.PatientId == patientId);
        var formStateJson = FormStateMerge.WithDefaults(record?.FormStateJson ?? "{}");
        var status = record?.Status ?? "draft";
        var now = DateTime.UtcNow;

        var eventSceneId = patient.OperationScene.ParentSceneId ?? patient.OperationScene.Id;
        var watermark = await BuildWatermarkAsync();

        db.AmbulanzprotokollExports.Add(new AmbulanzprotokollExport
        {
            PatientId = patientId,
            FormStateSnapshotJson = formStateJson,
            Status = status,
            GeneratedAt = now,
            ActorId = User.SubjectId(),
            ActorRole = User.TokenType() ?? "unknown",
            Watermark = watermark,
            CreatedAt = now,
        });

        audit.LogExport(User, "ambulanzprotokoll_export", patientId, patientId, watermark);

        await db.SaveChangesAsync();

        var metadata = new ProtokollExportMetadata(
            patientId, patient.HumanReadableId, patient.OperationSceneId, patient.OperationScene.Name,
            eventSceneId, now, watermark, AmbulanzprotokollSchemaValidator.CanonicalSchemaReference);

        var protokoll = new ProtokollRecordResponse(
            patientId, status, JsonDocument.Parse(formStateJson).RootElement, record?.UpdatedAt ?? patient.CreatedAt, record?.FinalizedAt);

        return Ok(new ProtokollExportResponse(metadata, protokoll));
    }

    private async Task<string> BuildWatermarkAsync()
    {
        var type = User.TokenType();
        var id = User.SubjectId();

        if (type is TokenTypes.Admin or TokenTypes.Leitstelle or TokenTypes.User && id is int userId)
        {
            var username = await db.Users.Where(u => u.Id == userId).Select(u => u.Username).FirstOrDefaultAsync();
            if (username is not null) return $"{username} ({type})";
        }

        return $"{type ?? "unknown"}-session:{id?.ToString() ?? "?"}";
    }

    // Draft edits are open to anyone with TriageWrite on the patient. Once finalized, correction
    // is restricted to Leitstelle/Admin, or to the identifiable account that owns the patient
    // record (FR-DOC-11/12). QR sessions are anonymous by design (FR-AUTH-07) and have no stable
    // identity to check "their own" against, so a finalized QR-created record can only be
    // reopened by Leitstelle/Admin — a deliberate, reviewable default, not an oversight.
    private bool CanCorrectFinalized(Patient patient)
    {
        var type = User.TokenType();
        if (type is TokenTypes.Admin or TokenTypes.Leitstelle) return true;
        if (type == TokenTypes.User && patient.UserIdUser is int owner && owner == User.SubjectId()) return true;
        return false;
    }

    private static List<string> BuildFinalizeWarnings(string formStateJson)
    {
        // Intentionally small and non-exhaustive (rebuild spec: "warnings... where detectable",
        // never a hard block). Grows as medical governance defines real acceptance rules.
        var warnings = new List<string>();
        var root = JsonNode.Parse(formStateJson) as JsonObject ?? [];

        var familienname = root["patient"]?["familienname"]?.GetValue<string>() ?? "";
        var vorname = root["patient"]?["vorname"]?.GetValue<string>() ?? "";
        if (string.IsNullOrWhiteSpace(familienname) && string.IsNullOrWhiteSpace(vorname))
        {
            warnings.Add("Patient name is empty.");
        }

        if (root["incident"]?["datum"] is null)
        {
            warnings.Add("Incident date is not set.");
        }

        return warnings;
    }

    // "GCS-Summe... computed as eyes + verbal + motor when all are present" (rebuild spec) — the
    // server recomputes it authoritatively rather than trusting whatever the client sent.
    public static string ApplyGcsAutoSum(string formStateJson)
    {
        var root = JsonNode.Parse(formStateJson) as JsonObject ?? [];
        var vitals = root["vitals"] as JsonObject;
        if (vitals is null) return formStateJson;

        var eyes = vitals["gcs_augenoeffnen"]?.GetValue<int?>();
        var verbal = vitals["gcs_verbale_reaktion"]?.GetValue<int?>();
        var motor = vitals["gcs_motorische_reaktion"]?.GetValue<int?>();

        vitals["gcs_summe"] = eyes is int e && verbal is int ve && motor is int m ? e + ve + m : null;

        return root.ToJsonString();
    }
}
