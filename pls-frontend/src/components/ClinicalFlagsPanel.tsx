import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getPersons, type Patient } from '../api/endpoints';
import { apiErrorMessage, isUnavailable } from '../api/client';
import { isProvisional, offlineQueue } from '../offline/offlineQueue';
import { usePatientTriage, type ClinicalFlag } from '../hooks/usePatientTriage';
import { useWorkContextStore } from '../stores/workContextStore';
import type { TriageColor } from '../types/triageColor';

const FLAGS: Array<{ flag: ClinicalFlag; field: keyof Patient; label: string }> = [
  { flag: 'respiration', field: 'atmung', label: 'Atmung suffizient' },
  { flag: 'blutung', field: 'blutung', label: 'Blutung stillbar' },
  { flag: 'radialispuls', field: 'radialispuls', label: 'Radialispuls tastbar' },
  { flag: 'transport', field: 'transport', label: 'Transport' },
  { flag: 'dringend', field: 'dringend', label: 'Dringend' },
  { flag: 'kontaminiert', field: 'kontaminiert', label: 'Kontaminiert' },
];

type Flags = Partial<Record<ClinicalFlag, boolean>>;

// One panel after the START result, not another wizard step (WP 3.3, AGENTS.md). Atmung and
// Blutung come pre-filled from what the wizard stored. Each change writes only its own flag, so
// edits of different flags from two devices both survive the server's per-field merge.
export default function ClinicalFlagsPanel({ triageResult }: { triageResult: TriageColor }) {
  const navigate = useNavigate();
  const location = useLocation();
  const patientId = useWorkContextStore((state) => state.patientId);
  const operationSceneId = useWorkContextStore((state) => state.operationSceneId);
  const { setFlag, error, saving } = usePatientTriage(patientId);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [qrBound, setQrBound] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');
  const [unknownServerState, setUnknownServerState] = useState(false);

  useEffect(() => {
    if (!patientId || !operationSceneId) return;
    let active = true;
    // Offline or a patient only on this device: what this device queued is known, nothing more.
    const fromQueue = async () => {
      const queued = Object.assign({}, ...(await offlineQueue.pendingTriage(patientId))) as Record<string, unknown>;
      if (!active) return;
      setFlags(Object.fromEntries(FLAGS.map(({ flag }) => [flag, queued[flag] === true])));
      setUnknownServerState(true);
    };
    if (isProvisional(patientId)) {
      void fromQueue();
      return () => {
        active = false;
      };
    }
    getPersons(operationSceneId)
      .then(async ({ data }) => {
        const patient = data.find((person) => person.id === patientId);
        if (!active) return;
        if (!patient) {
          setLoadError('Patient:in ist nicht (mehr) diesem Einsatzort zugeordnet.');
          return;
        }
        // Flags this device still has to send win over the server's older values.
        const queued = Object.assign({}, ...(await offlineQueue.pendingTriage(patientId))) as Record<string, unknown>;
        if (!active) return;
        setFlags(Object.fromEntries(FLAGS.map(({ flag, field }) => [flag, typeof queued[flag] === 'boolean' ? queued[flag] : patient[field] === true])));
        setQrBound(patient.qrCodeBound ?? null);
      })
      .catch((cause) => {
        if (!active) return;
        if (isUnavailable(cause)) void fromQueue();
        else setLoadError(apiErrorMessage(cause, 'Angaben konnten nicht geladen werden.'));
      });
    return () => {
      active = false;
    };
  }, [operationSceneId, patientId]);

  const toggle = async (flag: ClinicalFlag, value: boolean) => {
    if (await setFlag(flag, value)) setFlags((prev) => ({ ...prev, [flag]: value }));
  };

  return (
    <section className="triage-flags" aria-label="Weitere Angaben">
      <h3>Weitere Angaben</h3>
      {loadError && <p className="msg-error" role="alert">{loadError}</p>}
      {unknownServerState && (
        <p role="status">Offline: gespeicherte Angaben anderer Geräte sind nicht sichtbar. Änderungen werden später gesendet.</p>
      )}
      {flags &&
        FLAGS.map(({ flag, label }) => (
          <label key={flag} className="triage-flag">
            <input type="checkbox" checked={flags[flag] ?? false} disabled={saving} onChange={(e) => void toggle(flag, e.target.checked)} /> {label}
          </label>
        ))}
      {error && <p className="msg-error" role="alert">{error}</p>}
      {location.state?.qrReassigned && <p className="msg-success" role="status">QR-Code wurde zugeordnet.</p>}
      {/* Binding a QR code needs the server's patient id. */}
      {!isProvisional(patientId) && (
        <button
          type="button"
          className="triage-button triage-button--wide"
          onClick={() => navigate('/ScanPatient', { state: { reassignReturnTo: location.pathname, triageResult } })}
        >
          {qrBound === false ? 'QR-Code zuordnen' : 'QR-Code neu zuordnen'}
        </button>
      )}
    </section>
  );
}
