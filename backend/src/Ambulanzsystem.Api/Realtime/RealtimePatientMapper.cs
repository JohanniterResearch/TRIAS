using Ambulanzsystem.Api.Dtos;

namespace Ambulanzsystem.Api.Realtime;

public sealed class RealtimePatientMapper(IConfiguration configuration)
{
    private readonly bool _redact = configuration.GetValue<bool>("Features:RedactPersonalData");

    public PatientResponse Map(PatientResponse patient) => !_redact ? patient : patient with
    {
        Name = null,
        LongitudePatient = null,
        LatitudePatient = null,
        LocationSource = null,
        LocationAccuracyMeters = null,
        IndoorLocation = null,
        LocationUpdatedAt = null,
    };
}
