namespace Ambulanzsystem.Api.Auth;

public static class PasswordPolicy
{
    public const int MinimumLength = 8;
    public const string ErrorMessage = "Password must be at least 8 characters.";

    public static bool IsValid(string? password) =>
        !string.IsNullOrWhiteSpace(password) && password.Length >= MinimumLength;
}
