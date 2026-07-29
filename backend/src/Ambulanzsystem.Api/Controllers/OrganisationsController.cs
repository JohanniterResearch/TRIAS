using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Ambulanzsystem.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/organisations")]
[Authorize(Policy = AuthPolicies.AdminOnly)]
public class OrganisationsController(AppDbContext db, AuditService audit) : ControllerBase
{
    [HttpGet]
    [AuditRead("organisation_list")]
    public async Task<IActionResult> List()
    {
        var orgs = await db.Organisations.OrderBy(o => o.Name).ToListAsync();
        return Ok(orgs.Select(OrganisationResponse.From));
    }

    [HttpPost]
    public async Task<IActionResult> Create(CreateOrganisationRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new ErrorResponse("name is required."));
        }

        var org = new Organisation { Name = request.Name };
        db.Organisations.Add(org);

        // Id is unassigned until SaveChangesAsync; entityId stays null rather than adding a
        // second save just to populate it (D7 requirement 4: one save, no split transaction).
        audit.LogFieldWrite(User, "organisation", null, null, "created", null, org.Name);
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), OrganisationResponse.From(org));
    }
}
