import { useEffect, useState } from 'react';
import { getTriageHistory, type Patient, type TriageHistoryEntry } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';

const FIELD_LABEL: Record<string, string> = {
  triagefarbe: 'Triagefarbe',
  atmung: 'Atmung',
  blutung: 'Blutung',
  radialispuls: 'Radialispuls',
  transport: 'Transport',
  dringend: 'Dringend',
  kontaminiert: 'Kontaminiert',
};

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', leitstelle: 'Leitstelle', user: 'Einsatzkraft', qr: 'QR-Zugang' };

// Triage change history from the audit log (WP 3.5). Rendered for Leitstelle and Admin only; the
// server refuses responder and QR sessions anyway.
export default function TriageHistoryPanel({ persons }: { persons: Patient[] }) {
  const [patientId, setPatientId] = useState('');
  const [entries, setEntries] = useState<TriageHistoryEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    getTriageHistory(Number(patientId))
      .then(({ data }) => active && setEntries(data))
      .catch((cause) => active && setError(apiErrorMessage(cause, 'Verlauf konnte nicht geladen werden.')));
    return () => {
      active = false;
    };
  }, [patientId]);

  return (
    <section aria-label="Triage-Verlauf" style={{ margin: '12px 15px', textAlign: 'left' }}>
      <label htmlFor="triage-history-patient">Triage-Verlauf für Patient:In </label>
      <select id="triage-history-patient" value={patientId} onChange={(e) => {
          setEntries(null);
          setError('');
          setPatientId(e.target.value);
        }}>
        <option value="">auswählen</option>
        {persons.map((person) => (
          <option key={person.id} value={person.id}>
            {person.id}
            {person.humanReadableId ? ` (${person.humanReadableId})` : ''}
          </option>
        ))}
      </select>
      {error && <p className="msg-error" role="alert">{error}</p>}
      {patientId && entries && (entries.length === 0 ? (
        <p>Keine Änderungen erfasst.</p>
      ) : (
        <table border={1} aria-label={`Triage-Verlauf Patient ${patientId}`}>
          <thead>
            <tr>
              <th>Zeitpunkt</th>
              <th>Angabe</th>
              <th>Vorher</th>
              <th>Nachher</th>
              <th>Durch</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={`${entry.timestamp}-${entry.field}-${index}`}>
                <td>{new Date(entry.timestamp).toLocaleString('de-AT')}</td>
                <td>{FIELD_LABEL[entry.field] ?? entry.field}</td>
                <td>{entry.before ?? '–'}</td>
                <td>{entry.after ?? '–'}</td>
                <td>{entry.actorRole ? ROLE_LABEL[entry.actorRole] ?? entry.actorRole : ''} #{entry.actorId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}
