using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/metrics")]
[Authorize(Policy = AuthPolicies.AdminOnly)]
public class MetricsController(MetricsService metrics) : ControllerBase
{
    [HttpGet]
    [AuditRead("metrics")]
    public IActionResult Get() => Ok(metrics.Snapshot());
}
