import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Appbar from '../components/Appbar';
import BodyMapDrawing from '../components/BodyMapDrawing';
import QrCodeSheet from '../components/QrCodeSheet';
import {
  assignAdminPatientQrCode,
  getAdminPatientDetails,
  getAvailablePatientQrCodes,
  getOperationScenes,
  searchAdminPatients,
  updateAdminPatient,
  updateAdminPatientBodyParts,
  type AdminPatient,
  type AdminPatientDetails,
  type OperationScene,
} from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import { toAmbulanzRegion, type PlsBodyKey } from '../api/codecs/bodyMap';
import { printElement } from '../utils/printElement';

const PAGE_SIZE = 25;
const FLAGS = [
  ['atmung', 'Atmung suffizient'],
  ['blutung', 'Blutung stillbar'],
  ['radialispuls', 'Radialispuls tastbar'],
  ['transport', 'Transport'],
  ['dringend', 'Dringend'],
  ['kontaminiert', 'Kontaminiert'],
] as const;
type Flag = (typeof FLAGS)[number][0];
type Clinical = { name: string; triagefarbe: string } & Record<Flag, boolean>;

const clinicalOf = (patient: AdminPatient): Clinical => ({
  name: patient.name ?? '',
  triagefarbe: patient.triagefarbe ?? '',
  ...(Object.fromEntries(FLAGS.map(([flag]) => [flag, patient[flag] === true])) as Record<Flag, boolean>),
});

const validReason = (reason: string) => reason.trim().length >= 1 && reason.length <= 500;

// WP 5.3: Admin patient search and correction across all scenes. Every clinical change and every
// body-map change carries a reason (1-500) that the server stores in the audit log. Body regions
// go through the region codec like everywhere else.
export default function AdminPatientsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ search: '', operationSceneId: '', status: '' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; items: AdminPatient[] } | null>(null);
  const [scenes, setScenes] = useState<OperationScene[]>([]);
  const [details, setDetails] = useState<AdminPatientDetails | null>(null);
  const [clinical, setClinical] = useState<Clinical | null>(null);
  const [regions, setRegions] = useState<Record<string, number> | null>(null);
  const [reason, setReason] = useState('');
  const [available, setAvailable] = useState<Array<{ reference: string; label: string }>>([]);
  const [qrChoice, setQrChoice] = useState('');
  const [printable, setPrintable] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  const hasFilter = Boolean(filters.search.trim() || filters.operationSceneId || filters.status);

  const search = useCallback(async (targetPage = page) => {
    if (!hasFilter) return;
    setPage(targetPage);
    setError('');
    try {
      const { data } = await searchAdminPatients({
        search: filters.search.trim() || undefined,
        operationSceneId: filters.operationSceneId ? Number(filters.operationSceneId) : undefined,
        status: filters.status || undefined,
        page: targetPage,
        pageSize: PAGE_SIZE,
      });
      setResult(data);
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Suche fehlgeschlagen.'));
    }
  }, [filters, hasFilter, page]);

  useEffect(() => {
    getOperationScenes()
      .then(({ data }) => setScenes(data))
      .catch(() => setScenes([]));
  }, []);

  const open = async (patient: AdminPatient) => {
    setMessage('');
    setError('');
    setPrintable(null);
    try {
      const [{ data }, codes] = await Promise.all([getAdminPatientDetails(patient.editReference), getAvailablePatientQrCodes()]);
      setDetails(data);
      setClinical(clinicalOf(data.patient));
      setRegions(data.bodyParts);
      setReason('');
      setAvailable(codes.data.items);
      setQrChoice('');
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Patient:in konnte nicht geladen werden.'));
    }
  };

  const reload = async (reference: string, success: string) => {
    const { data } = await getAdminPatientDetails(reference);
    setDetails(data);
    setClinical(clinicalOf(data.patient));
    setRegions(data.bodyParts);
    setReason('');
    setMessage(success);
    void search(page);
  };

  const saveClinical = async () => {
    if (!details || !clinical) return;
    const before = clinicalOf(details.patient);
    // Only changed fields are sent, so the audit names exactly what was corrected.
    const changes: Record<string, unknown> = {};
    if (clinical.name !== before.name) changes.name = clinical.name.trim() || null;
    if (clinical.triagefarbe !== before.triagefarbe) changes.triagefarbe = clinical.triagefarbe || null;
    for (const [flag] of FLAGS) if (clinical[flag] !== before[flag]) changes[flag] = clinical[flag];
    if (Object.keys(changes).length === 0) return setMessage('Keine Änderung.');
    setError('');
    try {
      await updateAdminPatient(details.patient.editReference, { ...changes, correctionReason: reason.trim() });
      await reload(details.patient.editReference, 'Korrektur gespeichert.');
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Korrektur konnte nicht gespeichert werden.'));
    }
  };

  const toggleRegion = (plsKey: PlsBodyKey, isClicked: boolean) =>
    setRegions((current) => (current ? { ...current, [toAmbulanzRegion(plsKey)]: isClicked ? 1 : 0 } : current));

  const saveRegions = async () => {
    if (!details || !regions) return;
    setError('');
    try {
      // The server replaces the whole map. Only the regions the admin toggled are applied, on top
      // of a fresh read, so a mark set in the field meanwhile is kept (security review 3, M3).
      const edited = Object.keys(regions).filter((key) => regions[key] !== details.bodyParts[key]);
      const { data: fresh } = await getAdminPatientDetails(details.patient.editReference);
      const ownEdits = Object.fromEntries(edited.map((key) => [key, regions[key]]));
      const conflicts = edited.filter((key) => fresh.bodyParts[key] !== details.bodyParts[key]);
      if (conflicts.length) {
        setDetails(fresh);
        setRegions({ ...fresh.bodyParts, ...ownEdits });
        setError(`Inzwischen anderweitig geändert: ${conflicts.join(', ')}. Bitte prüfen und erneut speichern.`);
        return;
      }
      await updateAdminPatientBodyParts(details.patient.editReference, { bodyParts: { ...fresh.bodyParts, ...ownEdits }, correctionReason: reason.trim() });
      await reload(details.patient.editReference, 'Körperregionen korrigiert.');
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Körperregionen konnten nicht gespeichert werden.'));
    }
  };

  const assignQr = async () => {
    if (!details || !qrChoice) return;
    setError('');
    try {
      const { data } = await assignAdminPatientQrCode(
        details.patient.editReference,
        qrChoice === 'new' ? { source: 'new' } : { source: 'existing', qrReference: qrChoice },
      );
      // A new code is printable once, now; it is never shown again.
      setPrintable(data.printableQrToken ?? null);
      await reload(data.patient.editReference, 'QR-Code zugeordnet.');
    } catch (cause) {
      setError(apiErrorMessage(cause, 'QR-Code konnte nicht zugeordnet werden.'));
    }
  };

  const regionsChanged = details && regions && JSON.stringify(regions) !== JSON.stringify(details.bodyParts);

  return (
    <>
      <Appbar />
      <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
        <h2>Patient:innen suchen und korrigieren</h2>
        <button onClick={() => navigate('/AdminSettingsPage')}>Zurück zu den Einstellungen</button>
        {message && <p className="msg-success" role="status">{message}</p>}
        {error && <p className="msg-error" role="alert">{error}</p>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search(1);
          }}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '12px 0' }}
        >
          <label>
            ID, Nummer oder Name <input type="search" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          </label>
          <label>
            Einsatzort{' '}
            <select value={filters.operationSceneId} onChange={(e) => setFilters({ ...filters, operationSceneId: e.target.value })}>
              <option value="">Alle</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.name}</option>
              ))}
            </select>
          </label>
          <label>
            Protokoll{' '}
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Alle</option>
              <option value="draft">Entwurf</option>
              <option value="finalized">Finalisiert</option>
            </select>
          </label>
          <button type="submit" disabled={!hasFilter}>Suchen</button>
        </form>

        {result && (
          <>
            <table border={1} style={{ width: '100%' }} aria-label="Suchergebnis">
              <thead>
                <tr>
                  <th>Nummer</th>
                  <th>Name</th>
                  <th>Triagefarbe</th>
                  <th>Einsatzort</th>
                  <th>Protokoll</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.items.length === 0 && (
                  <tr>
                    <td colSpan={6}>Keine Treffer.</td>
                  </tr>
                )}
                {result.items.map((patient) => (
                  <tr key={patient.editReference}>
                    <td>{patient.humanReadableId ?? '–'}</td>
                    <td>{patient.name ?? ''}</td>
                    <td>{patient.triagefarbe ?? ''}</td>
                    <td>{scenes.find((scene) => scene.id === patient.operationSceneId)?.name ?? patient.operationSceneId}</td>
                    <td>{patient.protocolStatus === 'finalized' ? 'finalisiert' : 'Entwurf'}</td>
                    <td>
                      <button type="button" onClick={() => void open(patient)}>Öffnen</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <button type="button" disabled={page <= 1} onClick={() => void search(page - 1)}>Zurück</button>{' '}
              Seite {page} von {Math.max(1, Math.ceil(result.total / PAGE_SIZE))} ({result.total}){' '}
              <button type="button" disabled={page * PAGE_SIZE >= result.total} onClick={() => void search(page + 1)}>Weiter</button>
            </p>
          </>
        )}

        {details && clinical && (
          <section aria-label="Korrektur" className="settings-section" style={{ display: 'block' }}>
            <h3>
              Patient:in {details.patient.humanReadableId ?? ''} {details.patient.name ?? ''}
            </h3>

            <div className="form-group">
              <label htmlFor="correction-reason-admin">Grund der Korrektur (Pflicht, höchstens 500 Zeichen)</label>
              <textarea id="correction-reason-admin" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>

            <fieldset>
              <legend>Klinische Angaben</legend>
              <label>
                Name <input value={clinical.name} onChange={(e) => setClinical({ ...clinical, name: e.target.value })} />
              </label>{' '}
              <label>
                Triagefarbe{' '}
                <select value={clinical.triagefarbe} onChange={(e) => setClinical({ ...clinical, triagefarbe: e.target.value })}>
                  <option value="">keine</option>
                  <option value="rot">rot</option>
                  <option value="gelb">gelb</option>
                  <option value="gruen">grün</option>
                  <option value="schwarz">schwarz</option>
                </select>
              </label>
              {FLAGS.map(([flag, label]) => (
                <label key={flag} style={{ display: 'block' }}>
                  <input type="checkbox" checked={clinical[flag]} onChange={(e) => setClinical({ ...clinical, [flag]: e.target.checked })} /> {label}
                </label>
              ))}
              <button type="button" disabled={!validReason(reason)} onClick={() => void saveClinical()}>Angaben korrigieren</button>
            </fieldset>

            <fieldset>
              <legend>Körperregionen</legend>
              {regions && Object.keys(regions).length > 0 ? (
                <>
                  <BodyMapDrawing server={regions} onToggle={toggleRegion} label="Körperregionen korrigieren" />
                  <button type="button" disabled={!validReason(reason) || !regionsChanged} onClick={() => void saveRegions()}>Körperregionen korrigieren</button>
                </>
              ) : (
                <p>Keine Körperdaten erfasst.</p>
              )}
            </fieldset>

            <fieldset>
              <legend>Patienten-QR-Code ({details.qrCodeBound ? 'zugeordnet' : 'keiner'})</legend>
              <label>
                {details.qrCodeBound ? 'Neu zuordnen' : 'Zuordnen'}{' '}
                <select value={qrChoice} onChange={(e) => setQrChoice(e.target.value)}>
                  <option value="">auswählen</option>
                  <option value="new">Neuen QR-Code erzeugen</option>
                  {available.map((code) => (
                    <option key={code.reference} value={code.reference}>{code.label}</option>
                  ))}
                </select>
              </label>{' '}
              <button type="button" disabled={!qrChoice} onClick={() => void assignQr()}>QR-Code zuordnen</button>
              {printable && (
                <div>
                  <p>Der neue QR-Code wird nur jetzt angezeigt. Bitte drucken.</p>
                  <button type="button" onClick={() => printRef.current && printElement(printRef.current, 'Patienten-QR')}>Drucken</button>
                  <QrCodeSheet ref={printRef} items={[{ token: printable, caption: 'Patienten-QR' }]} />
                </div>
              )}
            </fieldset>

            <h4>Änderungsprotokoll</h4>
            <ul aria-label="Änderungsprotokoll">
              {details.auditEntries.map((entry, index) => (
                <li key={`${entry.timestamp}-${index}`}>
                  {new Date(entry.timestamp).toLocaleString('de-AT')} · {entry.actorRole} · {entry.action} {entry.entityType}
                  {entry.changedFields?.length ? `: ${entry.changedFields.join(', ')}` : ''}
                  {entry.reason ? ` – Grund: ${entry.reason}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
