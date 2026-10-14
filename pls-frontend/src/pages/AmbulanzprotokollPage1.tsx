import { useEffect, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import Appbar from '../components/Appbar';
import {
  AnamneseBodyMap,
  BrandHeader,
  IncidentHeader,
  MedicationGrid,
  PatientBlock,
  PrimaryAssessment,
} from '../features/ambulanzprotokoll-page1/page1UpperZones';
import { FindingsZone, FooterZone, MeasuresZone } from '../features/ambulanzprotokoll-page1/page1LowerZones';
import type { Page1State } from '../features/ambulanzprotokoll-page1/page1State';
import { useAmbulanzprotokollPage1Workflow } from '../features/ambulanzprotokoll-page1/page1Workflow';
import { useWorkContextStore } from '../stores/workContextStore';
import { useAuthStore } from '../stores/authStore';
import { exportPage1 } from '../features/ambulanzprotokoll-page1/page1Api';
import { apiErrorMessage, httpStatus } from '../api/client';
import '../styles/ambulanzprotokoll-page1.css';
import { downloadBlob } from '../utils/download';
import { onPatientMapped } from '../offline/offlineQueue';

function downloadJson(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: 'application/json' }));
}

export default function AmbulanzprotokollPage1() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const operationSceneId = useWorkContextStore((state) => state.operationSceneId);
  // The readable number of a manual patient, known when the protocol was opened from the
  // Lagebild or the triage flow (WP 3.1).
  const patientLabel = useWorkContextStore((state) => (String(state.patientId) === patientId ? state.patientLabel : null));
  const workflow = useAmbulanzprotokollPage1Workflow({
    patientId: Number(patientId ?? 0),
    operationSceneId,
  });
  const draft = (useWatch({ control: workflow.form.control }) ?? workflow.form.getValues()) as Page1State;
  // A patient created offline got its server id (WP 6.4): the page follows it.
  useEffect(() => onPatientMapped((provisionalId, patient) => {
    if (String(provisionalId) === patientId) navigate(`/AmbulanzprotokollPage1/${patient.id}`, { replace: true });
  }), [navigate, patientId]);
  // QR sessions can neither correct nor export; the server refuses both (WP 4.3, 4.4). A
  // responder may correct and export only own patients, which only the server knows.
  const isQrSession = useAuthStore((state) => state.session?.role === 'qr');
  const [correction, setCorrection] = useState<{ reason: string; editing: boolean } | null>(null);
  const [exportError, setExportError] = useState('');
  const finalized = workflow.status === 'finalized';
  const readOnly = finalized && !correction?.editing;
  const reasonValid = (correction?.reason.trim().length ?? 0) >= 1 && (correction?.reason.length ?? 0) <= 500;

  const handleSaveCorrection = async () => {
    if (!correction || !reasonValid) return;
    if (await workflow.saveCorrection(correction.reason.trim())) setCorrection(null);
  };

  const handleDiscardCorrection = () => {
    workflow.discardCorrection();
    setCorrection(null);
  };

  const handleExport = async () => {
    setExportError('');
    try {
      const exported = await exportPage1(Number(patientId));
      downloadJson(`ambulanzprotokoll-page1-${patientId}.json`, JSON.stringify(exported, null, 2));
    } catch (error) {
      setExportError(httpStatus(error) === 403
        ? 'Keine Berechtigung, dieses Protokoll zu exportieren.'
        : apiErrorMessage(error, 'Export fehlgeschlagen. Bitte erneut versuchen.'));
    }
  };

  useEffect(() => {
    document.title = `Ambulanzprotokoll Seite 1 - ${patientId ?? 'unbekannt'}`;
  }, [patientId]);

  return <>
    <Appbar />
    <div className="ambd-shell">
      <div className="ambd-shell__content">
        <header className="ambd-toolbar">
          <div className="ambd-toolbar__intro">
            <p className="ambd-toolbar__eyebrow">Johanniter Ambulanzprotokoll</p>
            <h1 className="ambd-toolbar__title">Seite 1</h1>
            <p className="ambd-toolbar__copy">Papierabbild mit identischer Abschnittsreihenfolge und unverändertem Backend-Workflow.</p>
          </div>
          <div className="ambd-toolbar__meta">
            <span className="ambd-toolbar__meta-item">patientId: {patientId ?? 'unbekannt'}</span>
            {patientLabel ? <span className="ambd-toolbar__meta-item">Nr.: {patientLabel}</span> : null}
            <span className="ambd-toolbar__meta-item">operationSceneId: {operationSceneId ?? 'n/a'}</span>
            <span className="ambd-toolbar__meta-item">Status: {workflow.status}</span>
            <span className="ambd-toolbar__meta-item">Sync: {workflow.syncState}</span>
            {workflow.lastSavedAt ? <span className="ambd-toolbar__meta-item">Gespeichert: {workflow.lastSavedAt}</span> : null}
          </div>
          <div className="ambd-toolbar__actions">
            <button className="ambd-toolbar__button" onClick={() => navigate('/SituationRoomTable')} type="button">Zurück</button>
            <button className="ambd-toolbar__button" onClick={() => window.print()} type="button">Drucken</button>
            {!isQrSession && <button className="ambd-toolbar__button" disabled={!workflow.isHydrated} onClick={() => void handleExport()} type="button">Export JSON</button>}
            {!finalized && <button className="ambd-toolbar__button ambd-toolbar__button--primary" disabled={!workflow.isHydrated} onClick={() => void workflow.finalize()} type="button">Finalisieren</button>}
            {finalized && !isQrSession && !correction && <button className="ambd-toolbar__button ambd-toolbar__button--primary" onClick={() => setCorrection({ reason: '', editing: false })} type="button">Korrektur</button>}
          </div>
        </header>

        {workflow.errorMessage ? <p className="ambd-error" role="alert">{workflow.errorMessage}</p> : null}
        {exportError ? <p className="ambd-error" role="alert">{exportError}</p> : null}
        {correction ? <div className="ambd-correction" role="region" aria-label="Korrektur">
          {correction.editing ? <>
            <p>Korrektur: <strong>{correction.reason}</strong>. Änderungen werden erst mit „Korrektur speichern“ übernommen.</p>
            <button className="ambd-toolbar__button ambd-toolbar__button--primary" disabled={workflow.syncState === 'saving'} onClick={() => void handleSaveCorrection()} type="button">Korrektur speichern</button>
            <button className="ambd-toolbar__button" onClick={handleDiscardCorrection} type="button">Verwerfen</button>
          </> : <>
            <label htmlFor="correction-reason">Grund der Korrektur (Pflicht, höchstens 500 Zeichen)</label>
            <textarea id="correction-reason" maxLength={500} value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} />
            <button className="ambd-toolbar__button ambd-toolbar__button--primary" disabled={!reasonValid} onClick={() => setCorrection({ ...correction, editing: true })} type="button">Korrektur beginnen</button>
            <button className="ambd-toolbar__button" onClick={() => setCorrection(null)} type="button">Abbrechen</button>
          </>}
        </div> : null}
        {workflow.validationWarnings.length > 0 ? <div className="ambd-warning" role="status">
          <strong>Hinweise zur Finalisierung</strong>
          <ul>{workflow.validationWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div> : null}

        {/* Inputs appear only after hydration: loading resets the form, so anything typed earlier
            would be overwritten. */}
        {workflow.syncState === 'loading' ? <p role="status">Ambulanzprotokoll wird geladen…</p> : !workflow.isHydrated ? null : <div className="ambd-paper-wrap">
          {/* Finalized protocols are read-only (WP 4.3); the fieldset disables every control
              without changing the paper layout (display: contents). */}
          <fieldset className="ambd-readonly" disabled={readOnly}>
          <div className="ambd-page" aria-label="Johanniter Ambulanzprotokoll Seite 1">
            <BrandHeader />
            <IncidentHeader form={workflow.form} />
            <PatientBlock form={workflow.form} />
            <PrimaryAssessment form={workflow.form} />
            <AnamneseBodyMap draft={draft} form={workflow.form} onBodyMapChange={workflow.setBodyMap} />
            <MedicationGrid draft={draft} form={workflow.form} />
            <FindingsZone draft={draft} form={workflow.form} />
            <MeasuresZone form={workflow.form} />
            <FooterZone draft={draft} form={workflow.form} onSignatureChange={workflow.setSignature} />
          </div>
          </fieldset>
        </div>}
      </div>
    </div>
  </>;
}
