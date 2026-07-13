using Ambulanzsystem.Api.Domain;

namespace Ambulanzsystem.Api.Dtos;

public record GenerateLoginQrCodesRequest(int Number, int EventSceneId, double? ExpiresInHours);

public record LoginQrCodeResponse(
    int Id,
    string QrToken,
    int EventSceneId,
    DateTime? FirstLogin,
    DateTime? ExpiresAt,
    double ExpiresInHours,
    DateTime? RevokedAt,
    DateTime CreatedAt)
{
    public static LoginQrCodeResponse From(QrCodeLogin c) => new(
        c.Id, c.QrToken, c.EventSceneId, c.FirstLogin, c.ExpiresAt, c.ExpiresInHours, c.RevokedAt, c.CreatedAt);
}
