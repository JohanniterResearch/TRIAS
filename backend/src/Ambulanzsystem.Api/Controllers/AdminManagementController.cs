using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/admin")]
[Authorize(Policy = AuthPolicies.AdminOnly)]
public class AdminManagementController(AppDbContext db, RefreshTokenService refreshTokens, AuditService audit, IDataProtectionProvider dataProtection) : ControllerBase
{
    private readonly IDataProtector patientReferences = dataProtection.CreateProtector("AdminManagement.PatientReference.v1");
    private readonly IDataProtector qrReferences = dataProtection.CreateProtector("AdminManagement.PatientQrReference.v1");
    [HttpGet("users")]
    public async Task<ActionResult<AdminUserPage>> Users([FromQuery] string? search, [FromQuery] Role? role, [FromQuery] AccountType? accountType, [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (status is not null && status is not ("active" or "revoked")) return BadRequest(new ErrorResponse("status must be active or revoked."));
        var query = db.Users.AsNoTracking().Where(u => u.Role != Role.Admin);
        if (!string.IsNullOrWhiteSpace(search)) query = query.Where(u => EF.Functions.ILike(u.Username, $"%{search.Trim()}%"));
        if (role is not null) query = query.Where(u => u.Role == role && role != Role.Admin);
        if (accountType is not null) query = query.Where(u => u.AccountType == accountType);
        if (status == "active") query = query.Where(u => u.RevokedAt == null);
        if (status == "revoked") query = query.Where(u => u.RevokedAt != null);
        page = Math.Max(page, 1); pageSize = Math.Clamp(pageSize, 1, 100);
        var total = await query.CountAsync();
        return Ok(new AdminUserPage(total, await query.OrderBy(u => u.Username).Skip((page - 1) * pageSize).Take(pageSize).Select(u => UserResponse.From(u)).ToListAsync()));
    }

    [HttpPut("users/{id:int}")]
    public async Task<IActionResult> UpdateUser(int id, UpdateAdminUserRequest request)
    {
        if (id == User.SubjectId()) return Forbid();
        var user = await RowLocks.UserAsync(db, id);
        if (user is null) return NotFound();
        if (user.Role == Role.Admin || request.Role == Role.Admin) return BadRequest(new ErrorResponse("Admin accounts are not managed here."));
        if (string.IsNullOrWhiteSpace(request.Username)) return BadRequest(new ErrorResponse("username is required."));
        if (await db.Users.AnyAsync(u => u.Id != id && u.Username == request.Username)) return Conflict(new ErrorResponse("Username already exists."));
        if (request.AccountType == AccountType.Event && request.EventSceneId is null) return BadRequest(new ErrorResponse("eventSceneId is required when accountType is event."));
        if (request.EventSceneId is int sceneId && !await SceneAccess.IsTopLevelEventAsync(db, sceneId)) return BadRequest(new ErrorResponse("eventSceneId must reference an existing top-level event."));

        var changed = user.Username != request.Username || user.Role != request.Role || user.AccountType != request.AccountType || user.EventSceneId != (request.AccountType == AccountType.Event ? request.EventSceneId : null);
        var before = new { user.Username, user.Role, user.AccountType, user.EventSceneId };
        user.Username = request.Username; user.Role = request.Role; user.AccountType = request.AccountType;
        user.EventSceneId = request.AccountType == AccountType.Event ? request.EventSceneId : null;
        if (changed) { user.SecurityStamp = Guid.NewGuid().ToString(); await refreshTokens.RevokeAllForUserAsync(user.Id); }
        audit.LogFieldWrite(User, "user", user.Id, null, "admin_configuration", before, new { user.Username, user.Role, user.AccountType, user.EventSceneId });
        await db.SaveChangesAsync();
        return Ok(UserResponse.From(user));
    }

    [HttpPost("users/{id:int}/reset-password")]
    public Task<IActionResult> ResetPassword(int id, ResetPasswordRequest request) => SetTemporaryPassword(id, request.TemporaryPassword, false);

    [HttpPost("users/{id:int}/reactivate")]
    public Task<IActionResult> Reactivate(int id, ResetPasswordRequest request) => SetTemporaryPassword(id, request.TemporaryPassword, true);

    private async Task<IActionResult> SetTemporaryPassword(int id, string password, bool reactivate)
    {
        if (id == User.SubjectId()) return Forbid();
        if (!PasswordPolicy.IsValid(password)) return BadRequest(new ErrorResponse(PasswordPolicy.ErrorMessage));
        var user = await RowLocks.UserAsync(db, id);
        if (user is null) return NotFound();
        if (user.Role == Role.Admin) return BadRequest(new ErrorResponse("Admin accounts are not managed here."));
        if (!reactivate && user.RevokedAt is not null) return Conflict(new ErrorResponse("Revoked accounts must be reactivated."));
        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password); user.RequiresPasswordChange = true;
        user.SecurityStamp = Guid.NewGuid().ToString();
        if (reactivate) { user.RevokedAt = null; user.RevokedBy = null; }
        await refreshTokens.RevokeAllForUserAsync(user.Id);
        audit.LogFieldWrite(User, "user", user.Id, null, reactivate ? "reactivated" : "password_reset", null, "changed");
        await db.SaveChangesAsync(); return NoContent();
    }

    [HttpGet("patients")]
    public async Task<ActionResult<AdminPatientPage>> Patients([FromQuery] string? search, [FromQuery] int? operationSceneId, [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (string.IsNullOrWhiteSpace(search) && operationSceneId is null && string.IsNullOrWhiteSpace(status)) return BadRequest(new ErrorResponse("A search or filter is required."));
        var query = db.Patients.AsNoTracking().Include(p => p.AmbulanzprotokollPage1).AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var numericId = int.TryParse(term, out var parsedId) ? parsedId : (int?)null;
            query = query.Where(p => p.HumanReadableId == term || numericId == p.Id || p.Name != null && EF.Functions.ILike(p.Name, $"%{term}%"));
        }
        if (operationSceneId is not null) query = query.Where(p => p.OperationSceneId == operationSceneId);
        if (status is "draft" or "finalized") query = query.Where(p => (p.AmbulanzprotokollPage1 == null ? "draft" : p.AmbulanzprotokollPage1.Status) == status);
        page = Math.Max(page, 1); pageSize = Math.Clamp(pageSize, 1, 100);
        var total = await query.CountAsync();
        var patients = await query.OrderByDescending(p => p.UpdatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        audit.LogRead(User, "admin_patient_search", null);
        await db.SaveChangesAsync();
        return Ok(new AdminPatientPage(total, patients.Select(p => AdminPatientResponse.From(p, p.AmbulanzprotokollPage1?.Status, ProtectPatientId(p.Id))).ToList()));
    }

    [HttpPut("patients/{reference}")]
    public async Task<IActionResult> UpdatePatient(string reference, [FromBody] JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object) return BadRequest(new ErrorResponse("Patient update must be a JSON object."));
        var id = UnprotectPatientId(reference);
        if (id is null) return NotFound();
        var patient = await RowLocks.PatientAsync(db, id.Value);
        if (patient is null) return NotFound();
        var clinical = new[] { "name", "triagefarbe", "atmung", "blutung", "radialispuls", "transport", "dringend", "kontaminiert", "latitudePatient", "longitudePatient", "locationSource", "locationAccuracyMeters", "indoorLocation" };
        var present = body.EnumerateObject().Select(x => x.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var reason = body.TryGetProperty("correctionReason", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : null;
        if (present.Overlaps(clinical) && (string.IsNullOrWhiteSpace(reason) || reason.Length > 500)) return BadRequest(new ErrorResponse("correctionReason must be 1 to 500 characters for clinical corrections."));
        if (body.TryGetProperty("operationSceneId", out var scene) && scene.ValueKind != JsonValueKind.Number) return BadRequest(new ErrorResponse("operationSceneId must be a number."));
        if (scene.ValueKind == JsonValueKind.Number && scene.GetInt32() != patient.OperationSceneId) {
            var hasTeam = await db.Teams.AnyAsync(t => t.OperationSceneId == patient.OperationSceneId && t.AssignedPatientId == id);
            if (hasTeam) return Conflict(new ErrorResponse("Clear or reassign the team before moving this patient."));
            if (!await db.OperationScenes.AnyAsync(s => s.Id == scene.GetInt32())) return BadRequest(new ErrorResponse("operationSceneId is invalid."));
            patient.OperationSceneId = scene.GetInt32();
        }
        foreach (var property in body.EnumerateObject()) ApplyPatientProperty(patient, property);
        audit.LogFieldsWrite(User, "patient", patient.Id, patient.Id, present.Where(x => x != "correctionReason").ToDictionary(x => x, _ => ((object?)null, (object?)"admin correction")), reason);
        await db.SaveChangesAsync(); return Ok(AdminPatientResponse.From(patient, await db.AmbulanzprotokollPage1s.Where(p => p.PatientId == id).Select(p => p.Status).FirstOrDefaultAsync(), ProtectPatientId(patient.Id)));
    }

    [HttpGet("patients/{reference}/details")]
    public async Task<ActionResult<AdminPatientDetails>> PatientDetails(string reference)
    {
        var id = UnprotectPatientId(reference);
        if (id is null) return NotFound();
        var patient = await db.Patients.AsNoTracking().Include(p => p.AmbulanzprotokollPage1).Include(p => p.QrCodePatient).FirstOrDefaultAsync(p => p.Id == id.Value);
        if (patient is null) return NotFound();
        var bodyJson = await db.Bodies.AsNoTracking().Where(b => b.PatientId == id.Value).Select(b => b.BodyPartsJson).FirstOrDefaultAsync();
        var parts = bodyJson is null ? new Dictionary<string, int>() : JsonSerializer.Deserialize<Dictionary<string, int>>(bodyJson)!;
        var formJson = FormStateMerge.WithDefaults(patient.AmbulanzprotokollPage1?.FormStateJson ?? "{}");
        var protocol = new AdminProtocolResponse(patient.AmbulanzprotokollPage1?.Status ?? "draft", JsonDocument.Parse(formJson).RootElement.Clone(), patient.AmbulanzprotokollPage1?.UpdatedAt ?? DateTime.UnixEpoch, patient.AmbulanzprotokollPage1?.FinalizedAt);
        var auditRows = await db.AuditLogs.AsNoTracking().Where(a => a.PatientId == id.Value).OrderByDescending(a => a.Timestamp).Take(10).ToListAsync();
        var entries = auditRows.Select(a => new AdminPatientAuditEntry(a.Timestamp, a.ActorRole, a.Action, a.EntityType, a.ChangedFieldsJson is null ? null : JsonSerializer.Deserialize<string[]>(a.ChangedFieldsJson), a.Reason)).ToList();
        audit.LogRead(User, "admin_patient_details", id.Value); await db.SaveChangesAsync();
        return Ok(new AdminPatientDetails(AdminPatientResponse.From(patient, patient.AmbulanzprotokollPage1?.Status, ProtectPatientId(patient.Id)), parts, protocol, patient.QrCodePatient is not null, entries));
    }

    [HttpPut("patients/{reference}/body-parts")]
    public async Task<ActionResult<AdminPatientDetails>> UpdateBodyParts(string reference, AdminBodyPartsUpdate request)
    {
        var id = UnprotectPatientId(reference);
        if (id is null) return NotFound();
        if (string.IsNullOrWhiteSpace(request.CorrectionReason) || request.CorrectionReason.Length > 500) return BadRequest(new ErrorResponse("correctionReason must be 1 to 500 characters for clinical corrections."));
        if (request.BodyParts.Keys.Any(key => !BodyRegions.AllKeys.Contains(key)) || request.BodyParts.Values.Any(value => value is not (0 or 1))) return BadRequest(new ErrorResponse("bodyParts must contain only canonical keys with values 0 or 1."));
        var body = await RowLocks.BodyAsync(db, id.Value);
        if (body is null) return NotFound();
        var before = JsonSerializer.Deserialize<Dictionary<string, int>>(body.BodyPartsJson)!;
        foreach (var key in BodyRegions.AllKeys) if (!request.BodyParts.ContainsKey(key)) return BadRequest(new ErrorResponse("bodyParts must contain every canonical key."));
        body.BodyPartsJson = JsonSerializer.Serialize(request.BodyParts);
        audit.LogFieldsWrite(User, "body", body.Id, id.Value, before.Where(x => request.BodyParts[x.Key] != x.Value).ToDictionary(x => x.Key, x => ((object?)x.Value, (object?)request.BodyParts[x.Key])), request.CorrectionReason);
        await db.SaveChangesAsync();
        return Ok(await DetailsFor(id.Value));
    }

    private async Task<AdminPatientDetails> DetailsFor(int id)
    {
        var patient = await db.Patients.AsNoTracking().Include(p => p.AmbulanzprotokollPage1).Include(p => p.QrCodePatient).SingleAsync(p => p.Id == id);
        var bodyJson = await db.Bodies.AsNoTracking().Where(b => b.PatientId == id).Select(b => b.BodyPartsJson).FirstOrDefaultAsync();
        var formJson = FormStateMerge.WithDefaults(patient.AmbulanzprotokollPage1?.FormStateJson ?? "{}");
        var auditRows = await db.AuditLogs.AsNoTracking().Where(a => a.PatientId == id).OrderByDescending(a => a.Timestamp).Take(10).ToListAsync();
        var entries = auditRows.Select(a => new AdminPatientAuditEntry(a.Timestamp, a.ActorRole, a.Action, a.EntityType, a.ChangedFieldsJson is null ? null : JsonSerializer.Deserialize<string[]>(a.ChangedFieldsJson), a.Reason)).ToList();
        return new(AdminPatientResponse.From(patient, patient.AmbulanzprotokollPage1?.Status, ProtectPatientId(id)), bodyJson is null ? [] : JsonSerializer.Deserialize<Dictionary<string, int>>(bodyJson)!, new(patient.AmbulanzprotokollPage1?.Status ?? "draft", JsonDocument.Parse(formJson).RootElement.Clone(), patient.AmbulanzprotokollPage1?.UpdatedAt ?? DateTime.UnixEpoch, patient.AmbulanzprotokollPage1?.FinalizedAt), patient.QrCodePatient is not null, entries);
    }

    [HttpGet("patient-qr-codes/available")]
    public async Task<ActionResult<AvailablePatientQrCodePage>> AvailablePatientQrCodes([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        page = Math.Max(page, 1); pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.QrCodePatients.AsNoTracking().Where(code => code.PatientId == null);
        var total = await query.CountAsync();
        var codes = await query.OrderByDescending(code => code.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new AvailablePatientQrCodePage(total, codes.Select(code => new AvailablePatientQrCode(
            ProtectQrId(code.Id), $"Erzeugt {code.CreatedAt:dd.MM.yyyy HH:mm}", code.CreatedAt)).ToList()));
    }

    [HttpPost("patients/{reference}/assign-qr-code")]
    public async Task<ActionResult<AssignAdminPatientQrCodeResponse>> AssignQrCode(string reference, AssignAdminPatientQrCodeRequest request)
    {
        var id = UnprotectPatientId(reference);
        if (id is null) return NotFound();
        if (request.Source is not ("existing" or "new") || request.Source == "existing" && string.IsNullOrWhiteSpace(request.QrReference))
            return BadRequest(new ErrorResponse("source must be existing with qrReference or new."));
        await using var tx = await db.Database.BeginTransactionAsync();
        var patient = await RowLocks.PatientAsync(db, id.Value);
        if (patient is null) return NotFound();
        var old = await db.QrCodePatients.FromSqlInterpolated($"SELECT * FROM qr_code_patients WHERE patient_id = {patient.Id} FOR UPDATE").SingleOrDefaultAsync();
        QrCodePatient code;
        if (request.Source == "new")
        {
            code = new QrCodePatient { QrToken = QrTokenGenerator.Generate() };
            db.QrCodePatients.Add(code);
        }
        else
        {
            var qrId = UnprotectQrId(request.QrReference!);
            if (qrId is null) return NotFound(new ErrorResponse("Unknown QR code."));
            var existing = await db.QrCodePatients.FromSqlInterpolated($"SELECT * FROM qr_code_patients WHERE id = {qrId.Value} FOR UPDATE").SingleOrDefaultAsync();
            if (existing is null) return NotFound(new ErrorResponse("Unknown QR code."));
            if (existing.PatientId is not null) return Conflict(new ErrorResponse("QR code is already bound to another patient."));
            code = existing;
        }
        if (old is not null) { old.PatientId = null; old.OperationSceneId = null; }
        code.PatientId = patient.Id; code.OperationSceneId = patient.OperationSceneId;
        audit.LogFieldWrite(User, "patient", patient.Id, patient.Id, "qr_code", old?.QrToken, code.QrToken);
        await db.SaveChangesAsync(); await tx.CommitAsync();
        var status = await db.AmbulanzprotokollPage1s.Where(p => p.PatientId == id).Select(p => p.Status).FirstOrDefaultAsync();
        return Ok(new AssignAdminPatientQrCodeResponse(AdminPatientResponse.From(patient, status, ProtectPatientId(patient.Id)), request.Source == "new" ? code.QrToken : null));
    }

    private string ProtectPatientId(int id) => patientReferences.Protect(id.ToString(System.Globalization.CultureInfo.InvariantCulture));
    private string ProtectQrId(int id) => qrReferences.Protect(id.ToString(System.Globalization.CultureInfo.InvariantCulture));

    private int? UnprotectPatientId(string reference)
    {
        try { return int.TryParse(patientReferences.Unprotect(reference), out var id) ? id : null; }
        catch { return null; }
    }

    private int? UnprotectQrId(string reference)
    {
        try { return int.TryParse(qrReferences.Unprotect(reference), out var id) ? id : null; }
        catch { return null; }
    }

    private static void ApplyPatientProperty(Patient p, JsonProperty x)
    {
        if (x.NameEquals("name")) p.Name = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetString();
        else if (x.NameEquals("triagefarbe")) { var v = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetString(); if (v is not null && v is not ("rot" or "gelb" or "gruen" or "schwarz")) throw new BadHttpRequestException("triagefarbe is invalid."); p.Triagefarbe = v; }
        else if (x.NameEquals("atmung")) p.Atmung = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("blutung")) p.Blutung = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("radialispuls")) p.Radialispuls = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("transport")) p.Transport = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("dringend")) p.Dringend = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("kontaminiert")) p.Kontaminiert = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetBoolean();
        else if (x.NameEquals("latitudePatient")) p.LatitudePatient = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetDouble();
        else if (x.NameEquals("longitudePatient")) p.LongitudePatient = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetDouble();
        else if (x.NameEquals("locationSource")) p.LocationSource = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetString();
        else if (x.NameEquals("locationAccuracyMeters")) p.LocationAccuracyMeters = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetDouble();
        else if (x.NameEquals("indoorLocation")) p.IndoorLocation = x.Value.ValueKind == JsonValueKind.Null ? null : x.Value.GetString();
        else if (x.NameEquals("operationSceneId") || x.NameEquals("correctionReason")) { }
        else throw new BadHttpRequestException($"Unknown patient field: {x.Name}.");
    }
}
