import { useState } from 'react';
import { offlineQueue, queuePersistent, useQueueStatus } from '../offline/offlineQueue';
import type { BlockedItem } from '../offline/queue';
import { isLeitstelleOrAdmin, useAuthStore } from '../stores/authStore';
import { downloadBlob } from '../utils/download';

// Sync indicator and issues panel (parity plan WP 6.5): what is still on this device, what the
// server refused, and the backup/discard path for both. Nothing is discarded unless saved first.

const TYPE_LABEL: Record<BlockedItem['type'], string> = {
  'manual-patient': 'Patient:in ohne QR',
  triage: 'Triage',
  location: 'GPS-Position',
  'body-part': 'Körperregion',
  protocol: 'Ambulanzprotokoll',
};

const patientName = (id: number) => (id < 0 ? `Lokal-${String(Math.abs(id)).slice(-6)}` : `Patient ${id}`);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

export default function SyncStatus() {
  const status = useQueueStatus();
  const isStaff = useAuthStore((state) => isLeitstelleOrAdmin(state.session?.role));
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');

  /** Runs a panel action; its message is what the action returns, else `done`. */
  const run = async (action: () => Promise<unknown>, done = '') => {
    setMessage('');
    try {
      const result = await action();
      setMessage(typeof result === 'string' ? result : done);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Aktion fehlgeschlagen.');
    }
  };

  const problems = status.blocked.length + (status.storageError ? 1 : 0) + (queuePersistent ? 0 : 1);
  const summary = !status.ready && !status.storageError
    ? 'Offline-Speicher wird geladen'
    : status.pendingCount === 0
      ? 'Alles gesendet'
      : `${status.pendingCount} ungesendet${status.lastError ? ` (${status.lastError})` : ''}`;

  return (
    <div className="sync-status">
      {/* aria-live on the button itself: a live region nested in it drops out of its name. */}
      <button type="button" className="admin-text" aria-live="polite" aria-expanded={open} aria-controls="sync-panel" onClick={() => setOpen(!open)}>
        Sync: {summary}{problems ? ` · ${problems} Problem${problems > 1 ? 'e' : ''}` : ''}
      </button>
      {open && (
        <section id="sync-panel" aria-label="Synchronisation" className="sync-panel">
          {!queuePersistent && (
            <p className="msg-error" role="alert">Dieser Browser bietet keinen Offline-Speicher: ungesendete Einträge gehen beim Neuladen verloren.</p>
          )}
          {status.storageError && <p className="msg-error" role="alert">{status.storageError}</p>}
          <p>
            {status.pendingCount === 0
              ? 'Keine ungesendeten Einträge dieser Anmeldung.'
              : `${status.pendingCount} ungesendete Einträge, ältester von ${new Date(status.oldestPendingAt!).toLocaleString('de-AT')}.`}
            {status.lastFlushAt && ` Zuletzt gesendet: ${new Date(status.lastFlushAt).toLocaleTimeString('de-AT')}.`}
          </p>
          {status.pendingCount > 0 && (
            <button type="button" onClick={() => void run(() => offlineQueue.flush(true))}>Jetzt senden</button>
          )}

          {status.blocked.length > 0 && (
            <>
              <h3>Vom Server abgelehnt</h3>
              <ul>
                {status.blocked.map((item) => (
                  <li key={item.id}>
                    {TYPE_LABEL[item.type]}, {patientName(item.patientId)}: {item.lastError ?? `HTTP ${item.errorStatus}`}
                    <button type="button" onClick={() => void run(() => offlineQueue.retry(item.id))}>Erneut senden</button>
                    <button type="button" onClick={() => void run(async () => downloadBlob(`pls-eintrag-${stamp()}.json`, await offlineQueue.exportItems(item.id)), 'Als Datei gesichert.')}>
                      Als Datei sichern
                    </button>
                    <button type="button" onClick={() => void run(() => offlineQueue.discard(item.id), 'Verworfen.')}>Verwerfen</button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {status.foreignCount > 0 && (
            <>
              <h3>Einträge anderer Anmeldungen</h3>
              <p>
                {status.foreignCount} ungesendete Einträge anderer Anmeldungen liegen auf diesem Gerät. Sie werden nur unter der
                jeweiligen Anmeldung gesendet, sobald sie sich hier wieder anmeldet.
              </p>
              {isStaff && (
                <>
                  <button type="button" onClick={() => void run(async () => downloadBlob(`pls-geraet-${stamp()}.json`, await offlineQueue.exportForeign()), 'Als Datei gesichert.')}>
                    Alle als Datei sichern
                  </button>
                  <button type="button" onClick={() => void run(async () => `${await offlineQueue.discardExportedForeign()} gesicherte Einträge verworfen.`)}>
                    Gesicherte verwerfen
                  </button>
                </>
              )}
            </>
          )}
          {(status.blocked.length > 0 || (isStaff && status.foreignCount > 0)) && (
            <p className="sync-note">Gesicherte Dateien enthalten Patientendaten: nur auf einem dienstlichen Gerät ablegen und nach Übergabe löschen.</p>
          )}
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </div>
  );
}
