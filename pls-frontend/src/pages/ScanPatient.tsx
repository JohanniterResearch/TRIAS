import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQrScanner } from '../hooks/useQrScanner';
import { createManualPatient, reassignPatientQrCode, verifyPatientQrCode, type Patient } from '../api/endpoints';
import { apiErrorMessage, httpStatus, isUnavailable } from '../api/client';
import { usePatientLocationStore } from '../stores/patientLocationStore';
import { useWorkContextStore } from '../stores/workContextStore';
import { offlineQueue } from '../offline/offlineQueue';
import { currentDraftOwner } from '../features/ambulanzprotokoll-page1/page1Storage';

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 from getRandomValues (randomUUID needs a secure context).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getPatientQrErrorMessage(error: unknown): string {
  const status = httpStatus(error);
  if (status === 409) return apiErrorMessage(error, 'Dieser QR-Code ist bereits einem anderen Patienten zugeordnet.');
  if (status === 404) return 'Ungültiger Patienten QR-Code.';
  if (status === 403) return 'Kein Zugriff auf diesen Einsatzort oder Patienten.';
  if (status) return apiErrorMessage(error, `Patienten QR-Code konnte nicht verarbeitet werden. Status: ${status}`);
  return 'Patienten QR-Code konnte nicht verarbeitet werden. Keine Verbindung zum Server.';
}

export default function ScanPatient() {
  const operationSceneId = useWorkContextStore((state) => state.operationSceneId);
  const setPatient = useWorkContextStore((state) => state.setPatient);
  const currentPatientId = useWorkContextStore((state) => state.patientId);
  // Reassign mode (WP 3.2): the scanned code is bound to the current patient instead of opening one.
  const location = useLocation();
  const reassignReturnTo: string | undefined = location.state?.reassignReturnTo;
  const reassigning = Boolean(reassignReturnTo && currentPatientId);
  const [creating, setCreating] = useState(false);
  const ensurePatientLocation = usePatientLocationStore((state) => state.ensurePatientLocation);
  const navigate = useNavigate();
  // Never in a production build, whatever the environment says (security review L4).
  const devButtonsEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEV_BUTTONS === 'true';
  const [devQrCode, setDevQrCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const onScanSuccess = (decodedText: string) => {
    if (!operationSceneId || operationSceneId < 1) {
      setErrorMessage('Bitte zuerst einen Einsatzort in der Rollenauswahl auswählen.');
      return;
    }

    setErrorMessage('');
    if (reassigning) {
      reassignPatientQrCode(currentPatientId!, decodedText)
        .then(() => {
          stopScanner();
          // Replaces the reassign entry: Back must not re-enter reassign mode and bind the next
          // casualty's tag to this patient (security review 3, L5).
          navigate(reassignReturnTo!, { replace: true, state: { qrReassigned: true, triageResult: location.state?.triageResult } });
        })
        .catch((error) => setErrorMessage(getPatientQrErrorMessage(error)));
      return;
    }
    verifyPatientQrCode(decodedText, operationSceneId)
      .then(({ data }) => {
        const patientId = data.patient.id;
        setPatient(patientId, data.patient.humanReadableId ?? null);
        void ensurePatientLocation(patientId);
        stopScanner();
        navigate('/TriagePage1');
      })
      .catch((error) => setErrorMessage(getPatientQrErrorMessage(error)));
  };

  const handleManualPatient = async () => {
    if (!operationSceneId || operationSceneId < 1) {
      setErrorMessage('Bitte zuerst einen Einsatzort in der Rollenauswahl auswählen.');
      return;
    }
    // Offline, or the answer got lost: the patient is created on this device (Lokal-NNNNNN) and the
    // queue sends it with the same client id, so the server never creates it twice (WP 6.4).
    const clientGeneratedId = newClientId();
    const owner = currentDraftOwner() ?? undefined;
    setCreating(true);
    setErrorMessage('');
    try {
      let patient: Patient;
      try {
        patient = (await createManualPatient({ operationSceneId, clientGeneratedId }, { expectedOwner: owner })).data;
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        patient = await offlineQueue.createProvisionalPatient({ operationSceneId, clientGeneratedId }, owner);
      }
      setPatient(patient.id, patient.humanReadableId ?? null);
      void ensurePatientLocation(patient.id);
      stopScanner();
      navigate('/TriagePage1');
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Patient konnte nicht angelegt werden. Bitte erneut versuchen.'));
    } finally {
      setCreating(false);
    }
  };

  const { cameraBlocked, stopScanner } = useQrScanner({
    elementId: 'reader',
    fps: 5,
    qrbox: { width: 200, height: 200 },
    onSuccess: onScanSuccess,
  });

  return (
    <div>
      <h2>{reassigning ? `Neuen QR-Code für Patient:In ${currentPatientId} scannen` : 'Bitte einen Patienten QR-Code scannen'}</h2>
      <div id="reader"></div>
      {cameraBlocked && (
        <p style={{ color: 'red', fontWeight: 'bold' }} role="alert">
          Der Zugriff auf die Kamera wurde verweigert. Bitte erlauben Sie den
          Zugriff auf die Kamera über die Einstellungen.
        </p>
      )}
      {errorMessage && (
        <p style={{ color: 'red', fontWeight: 'bold' }} role="alert">{errorMessage}</p>
      )}
      <div style={{ marginTop: '1rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {reassigning ? (
          <button onClick={() => navigate(reassignReturnTo!, { state: { triageResult: location.state?.triageResult } })}>Abbrechen</button>
        ) : (
          <>
            <button onClick={() => void handleManualPatient()} disabled={creating}>
              {creating ? 'Lege Patient an...' : 'Patient ohne QR'}
            </button>
            <button onClick={() => navigate('/RoleSelection')}>
              Zur Rollenauswahl
            </button>
          </>
        )}
      </div>
      {devButtonsEnabled && (
        // DEV ONLY: lets camera-less test runs enter a patient QR token.
        <form
          style={{ marginTop: '2rem', border: '2px dashed orange', padding: '1rem' }}
          onSubmit={(event) => {
            event.preventDefault();
            onScanSuccess(devQrCode.trim());
          }}
        >
          <p style={{ color: 'orange', fontWeight: 'bold' }}>⚠ DEV ONLY</p>
          <label htmlFor="dev-patient-qr">DEV: Patienten-QR-Code</label>
          <input id="dev-patient-qr" value={devQrCode} onChange={(e) => setDevQrCode(e.target.value)} />
          <button type="submit" disabled={!devQrCode.trim()}>QR-Code verwenden</button>
        </form>
      )}
    </div>
  );
}
