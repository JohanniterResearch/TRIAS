namespace Ambulanzsystem.Api.Dtos;

public record QrLoginRequest(string qr_code);
public record QrLoginResponse(string status, string token, int eventSceneId);

public record CredentialsRequest(string Username, string Password);

public record UserLoginResponse(string status, string token, string refreshToken);

public record AdminLoginResponse(
    string status,
    string token,
    string refreshToken,
    bool requiresPasswordChange,
    string role,
    int? eventSceneId);

public record RefreshTokenRequest(string RefreshToken);
public record RefreshTokenResponse(string token, string refreshToken);

public record ValidateTokenResponse(bool isValid, string role);

public record DevLoginRequest(string role);
public record DevLoginResponse(string status, string token, string username, bool requiresPasswordChange);

public record ErrorResponse(string message)
{
    public string status => "error";
}
