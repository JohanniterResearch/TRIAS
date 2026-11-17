using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Realtime;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Ambulanzsystem.Api.Filters;

// Applied only to the additional patient-related routes. Steps 2–4 retain their ledgers.
public sealed class PatientWriteAttribute : TypeFilterAttribute
{
    public PatientWriteAttribute(string scope) : base(typeof(PatientWriteFilter)) => Arguments = [scope];
}

public sealed class PatientWriteFilter(string scope, AppDbContext db, SceneNotifier notifier,
    IDataProtectionProvider protection, IOptions<JsonOptions> jsonOptions) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var args = context.ActionArguments;
        var payload = args.TryGetValue("request", out var request) ? request! : args.TryGetValue("body", out var body) ? body! : new { };
        Guid? key = null;
        if (scope == "manual") key = ((ManualPatientRequest)payload).ClientGeneratedId;
        else if (context.HttpContext.Request.Headers.TryGetValue("Idempotency-Key", out var header))
        {
            if (header.Count != 1 || header[0]?.Length != 36 || !Guid.TryParseExact(header[0], "D", out var parsed) || parsed == Guid.Empty)
            { context.Result = new BadRequestObjectResult(new ErrorResponse("Idempotency-Key must be a non-empty UUID in hyphenated format.")); return; }
            key = parsed;
        }

        int? targetId = args.TryGetValue("id", out var id) ? (int)id! : null;
        if (args.TryGetValue("patientId", out var protocolPatient)) targetId = (int)protocolPatient!;
        if (args.TryGetValue("reference", out var reference))
        {
            try { targetId = int.Parse(protection.CreateProtector("AdminManagement.PatientReference.v1").Unprotect((string)reference!)); }
            catch { context.Result = new NotFoundResult(); return; }
        }
        var target = scope == "qr-intake"
            ? Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(((VerifyQrCodeRequest)payload).qr_code ?? "")))
            : targetId?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "new";

        await using var tx = await db.Database.BeginTransactionAsync();
        // QR assignment spans patients and tokens: all three writers take this lock first.
        if (scope is "qr-intake" or "qr-reassign" or "admin-qr") await LockAsync("patient-qr-assignments");
        if (key is Guid writeId) await LockAsync($"{scope}:{target}:{writeId:D}");

        // Authorization runs on every delivery, before any cached patient data is returned.
        if (payload is ManualPatientRequest manual && !await SceneAccess.CanAccessAsync(context.HttpContext.User, db, manual.OperationSceneId) ||
            payload is VerifyQrCodeRequest scan && !await SceneAccess.CanAccessAsync(context.HttpContext.User, db, scan.OperationSceneId))
        { context.Result = new ForbidResult(); return; }
        if (targetId is int targetValue)
        {
            int? sceneId;
            if (scope == "team")
            {
                var team = await db.Teams.FromSqlInterpolated($"SELECT * FROM teams WHERE id = {targetValue} FOR UPDATE").SingleOrDefaultAsync();
                sceneId = team?.OperationSceneId;
            }
            else sceneId = await db.Patients.Where(p => p.Id == targetValue).Select(p => (int?)p.OperationSceneId).SingleOrDefaultAsync();
            if (sceneId is null) { context.Result = new NotFoundResult(); return; }
            if (!await SceneAccess.CanAccessAsync(context.HttpContext.User, db, sceneId.Value)) { context.Result = new ForbidResult(); return; }
            if (scope == "protocol-export" && context.HttpContext.User.TokenType() is not (TokenTypes.Admin or TokenTypes.Leitstelle))
            {
                var owner = await db.Patients.Where(p => p.Id == targetValue).Select(p => p.UserIdUser).SingleAsync();
                if (context.HttpContext.User.TokenType() != TokenTypes.User || owner is null || owner != context.HttpContext.User.SubjectId())
                { context.Result = new ForbidResult(); return; }
            }
        }

        var checksum = Checksum(payload);
        if (key is Guid lookup)
        {
            var receipt = await db.PatientWriteReceipts.FindAsync(scope, target, lookup);
            if (receipt is not null)
            {
                if (receipt.PatientId is int patientId)
                {
                    var scene = await db.Patients.Where(p => p.Id == patientId).Select(p => (int?)p.OperationSceneId).SingleOrDefaultAsync();
                    if (scene is null) { context.Result = new NotFoundResult(); return; }
                    if (!await SceneAccess.CanAccessAsync(context.HttpContext.User, db, scene.Value)) { context.Result = new ForbidResult(); return; }
                }
                if (scope == "respiration" && receipt.Checksum == checksum && receipt.PatientId is int respirationPatient)
                {
                    var original = JsonSerializer.Deserialize<PatientResponse>(receipt.ResultJson, jsonOptions.Value.JsonSerializerOptions)!;
                    var patient = await db.Patients.AsNoTracking().SingleAsync(p => p.Id == respirationPatient);
                    // Old receipt: unknown decision stays unknown. Do not infer from today's value.
                    var decisions = original.FieldResults is null ? null : JsonSerializer.Serialize(original.FieldResults
                        .Select(r => new Ambulanzsystem.Api.Services.FieldDecision(r.Field, r.Outcome, r.ConflictReason)), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                    context.Result = new OkObjectResult(PatientResponse.From(patient) with { FieldResults = Ambulanzsystem.Api.Services.FieldWriteDecisions.PatientResults(decisions, patient) });
                    return;
                }
                context.Result = receipt.Checksum != checksum
                    ? new ConflictObjectResult(new ErrorResponse("The order key was already used with different contents."))
                    : new ContentResult { StatusCode = 200, ContentType = "application/json", Content = receipt.ResultJson };
                return;
            }
        }

        notifier.BeginPatientWrite();
        try
        {
            var executed = await next();
            if (executed.Exception is not null || executed.Result is not ObjectResult result || (result.StatusCode ?? 200) >= 400) return;
            // Legacy manual patients have no immutable creation checksum. Never invent one.
            if (key is Guid completed && !(scope == "manual" && result.StatusCode != 201))
            {
                int? patientId = scope switch
                {
                    "manual" => ((PatientResponse)result.Value!).Id,
                    "qr-intake" => ((VerifyQrResult)result.Value!).Patient.Id,
                    "team" => ((TeamResponse)result.Value!).AssignedPatientId,
                    _ => targetId,
                };
                db.PatientWriteReceipts.Add(new PatientWriteReceipt { Scope = scope, Target = target, WriteId = completed,
                    Checksum = checksum, PatientId = patientId, ResultJson = JsonSerializer.Serialize(result.Value, jsonOptions.Value.JsonSerializerOptions) });
                await db.SaveChangesAsync();
            }
            await tx.CommitAsync();
            notifier.CommitPatientWrite();
        }
        finally { notifier.DiscardPatientWrite(); }
    }

    private Task<int> LockAsync(string value) => db.Database.ExecuteSqlInterpolatedAsync(
        $"SELECT pg_advisory_xact_lock({BinaryPrimitives.ReadInt64BigEndian(SHA256.HashData(Encoding.UTF8.GetBytes(value)))})");

    private static string Checksum(object payload)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer)) Write(writer, JsonSerializer.SerializeToElement(payload));
        return Convert.ToHexString(SHA256.HashData(buffer.ToArray()));
    }

    private static void Write(Utf8JsonWriter writer, JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            writer.WriteStartObject();
            foreach (var p in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal)) { writer.WritePropertyName(p.Name); Write(writer, p.Value); }
            writer.WriteEndObject();
        }
        else if (value.ValueKind == JsonValueKind.Array) { writer.WriteStartArray(); foreach (var v in value.EnumerateArray()) Write(writer, v); writer.WriteEndArray(); }
        else value.WriteTo(writer);
    }
}
