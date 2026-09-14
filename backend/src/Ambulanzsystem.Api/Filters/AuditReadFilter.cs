using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Ambulanzsystem.Api.Filters;

// Global action filter — cheap no-op for the vast majority of actions (no [AuditRead]
// attribute); for the handful of patient-bearing GET endpoints that carry it, logs exactly one
// audit row per successful request after the action completes.
public class AuditReadFilter(AppDbContext db) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var executed = await next();

        if (executed.Exception is not null || executed.Canceled) return;
        if (executed.Result is not Microsoft.AspNetCore.Mvc.ObjectResult { StatusCode: null or >= 200 and < 300 }) return;

        var attribute = (context.ActionDescriptor as ControllerActionDescriptor)?.MethodInfo
            .GetCustomAttributes(typeof(AuditReadAttribute), inherit: false)
            .Cast<AuditReadAttribute>()
            .FirstOrDefault();
        if (attribute is null) return;

        var id = attribute.IdSource switch
        {
            AuditIdSource.Route => context.RouteData.Values.TryGetValue(attribute.IdParam, out var r)
                && int.TryParse(r?.ToString(), out var rv) ? rv : (int?)null,
            AuditIdSource.Query => context.HttpContext.Request.Query.TryGetValue(attribute.IdParam, out var q)
                && int.TryParse(q, out var qv) ? qv : (int?)null,
            _ => null,
        };
        if (attribute.IdSource != AuditIdSource.None && id is null) return;

        db.AuditLogs.Add(new AuditLog
        {
            Timestamp = DateTime.UtcNow,
            ActorId = context.HttpContext.User.SubjectId(),
            ActorRole = context.HttpContext.User.TokenType() ?? "unknown",
            Action = "read",
            EntityType = attribute.EntityType,
            EntityId = id,
            PatientId = attribute.EntityType == "patient" ? id : null,
        });

        await db.SaveChangesAsync();
    }
}
