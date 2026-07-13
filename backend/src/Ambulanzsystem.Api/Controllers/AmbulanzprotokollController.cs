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

        var record = await db.AmbulanzprotokollPage1s.FirstOrDefaultAsync(r => r.PatientId == patientId);

        var formStateJson = FormStateMerge.WithDefaults(record?.FormStateJson ?? "{}");
        var formState = JsonDocument.Parse(formStateJson).RootElement;

        return Ok(new ProtokollRecordResponse(
            patientId,
            record?.Status ?? "draft",
            formState,
            record?.UpdatedAt ?? patient.CreatedAt,
            record?.FinalizedAt));
    }

    [HttpPut]
    public async Task<IActionResult> Upsert(int patientId, UpsertProtokollRequest request)
    {
        var patient = await db.Patients.FindAsync(patientId);
        if (patient is null) return NotFound();

        if (request.Status is not ("draft" or "finalized"))
        {
            return BadRequest(new ErrorResponse("status must be draft or finalized."));
        }

        var record = await db.AmbulanzprotokollPage1s.FirstOrDefaultAsync(r => r.PatientId == patientId);
        var wasFinalized = record?.Status == "finalized";

        if (wasFinalized && !CanCorrectFinalized(patient))
        {
            return Forbid();
        }

        record ??= new AmbulanzprotokollPage1 { PatientId = patientId };
        var isNew = record.Id == 0;

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

        audit.LogFieldWrite(User, "ambulanzprotokoll", record.Id, patientId, "status", oldStatus, record.Status);

        await db.SaveChangesAsync();

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

        audit.LogFieldWrite(User, "ambulanzprotokoll_export", patientId, patientId, "export", null, watermark);

        await db.SaveChangesAsync();

        var metadata = new ProtokollExportMetadata(
            patientId, patient.HumanReadableId, patient.OperationSceneId, patient.OperationScene.Name,
            eventSceneId, now, watermark, "1");

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
    private static string ApplyGcsAutoSum(string formStateJson)
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
