using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Data;
using Ambulanzsystem.Api.Domain;
using Ambulanzsystem.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Ambulanzsystem.Api.Controllers;

[ApiController]
[Route("api/organisations")]
[Authorize(Policy = AuthPolicies.AdminOnly)]
public class OrganisationsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
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
        await db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), OrganisationResponse.From(org));
    }
}
