namespace Ambulanzsystem.Api.Dtos;

public static class ExternalStringLimits
{
    public const int Name = 255;
    public const int ShortText = 255;
    public const int Description = 2000;

    public static bool IsValidCorrectionReason(string? reason) =>
        !string.IsNullOrWhiteSpace(reason) && reason.Length <= 500;
}
