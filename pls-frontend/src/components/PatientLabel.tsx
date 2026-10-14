import { useWorkContextStore } from '../stores/workContextStore';

/** "Patient:In ID: 12 · Nr. M-0003": the readable number of a manual patient (WP 3.1). */
export default function PatientLabel() {
  const patientId = useWorkContextStore((state) => state.patientId);
  const patientLabel = useWorkContextStore((state) => state.patientLabel);
  return (
    <>
      Patient:In ID: {patientId}
      {patientLabel ? ` · Nr. ${patientLabel}` : ''}
    </>
  );
}
