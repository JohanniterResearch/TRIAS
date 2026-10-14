import { usePatientLocationStore } from '../stores/patientLocationStore';

interface PatientLocationStatusProps {
  patientId: number | null | undefined;
}

export default function PatientLocationStatus({ patientId }: PatientLocationStatusProps) {
  const job = usePatientLocationStore((state) =>
    patientId ? state.jobs[patientId] : undefined
  );

  if (!patientId) return null;

  if (!job) {
    return <p>GPS: wird vorbereitet</p>;
  }

  if (job.status === 'locating') {
    return <p>GPS: wird ermittelt</p>;
  }

  if (job.status === 'writing') {
    return <p>GPS: wird gespeichert</p>;
  }

  if (job.status === 'error') {
    return <p>GPS Fehler: {job.error}</p>;
  }

  return (
    <div>
      <p>{job.status === 'queued' ? 'GPS: auf dem Gerät gespeichert, wird gesendet' : 'GPS: gespeichert'}</p>
      {job.coordinates && (
        <>
          <p>Breitengrad: {job.coordinates.lat}</p>
          <p>Längengrad: {job.coordinates.lng}</p>
        </>
      )}
    </div>
  );
}
