using System.ComponentModel.DataAnnotations;
using Ambulanzsystem.Api.Auth;
using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

// Role is nullable on purpose: a missing role in the request must be a 400, never a silent
// default — Role.Admin is enum value 0, so an unvalidated default would create admins by accident.
public record CreateUserRequest(
    [Required, MaxLength(ExternalStringLimits.Name)] string Username,
    [Required, MinLength(PasswordPolicy.MinimumLength)] string Password,
    Role? Role,
    AccountType AccountType = AccountType.Permanent,
    int? EventSceneId = null);

public record UserResponse(
    int Id,
    string Username,
    Role Role,
    AccountType AccountType,
    int? EventSceneId,
    bool RequiresPasswordChange,
    DateTime? RevokedAt,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static UserResponse From(User u) => new(
        u.Id, u.Username, u.Role, u.AccountType, u.EventSceneId,
        u.RequiresPasswordChange, u.RevokedAt, u.CreatedAt, u.UpdatedAt);
}

public record ChangePasswordRequest(
    [Required, MaxLength(ExternalStringLimits.Name)] string Username,
    [Required] string Password,
    [Required, MinLength(PasswordPolicy.MinimumLength)] string NewPassword);
