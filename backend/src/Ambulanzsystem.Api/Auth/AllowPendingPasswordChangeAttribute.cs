namespace Ambulanzsystem.Api.Auth;

// Marks an action as reachable even while the authenticated user has a forced password change
// pending (AuthPolicies.PasswordChangeGateAllows). Applied only to change-password, logout,
// self-cancel, and validate-token — the endpoints a user in this state needs to get unstuck.
[AttributeUsage(AttributeTargets.Method)]
public class AllowPendingPasswordChangeAttribute : Attribute;
