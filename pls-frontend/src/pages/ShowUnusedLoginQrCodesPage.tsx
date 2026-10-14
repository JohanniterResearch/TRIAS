import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Appbar from '../components/Appbar';
import QrCodeSheet from '../components/QrCodeSheet';
import { getLoginQrCodes, getOperationScenes, revokeLoginQrCode, type LoginQrCode, type OperationScene } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import { printElement } from '../utils/printElement';

function codeStatus(code: LoginQrCode, now: number): string {
  if (code.revokedAt) return 'widerrufen';
  if (!code.firstLogin) return 'unbenutzt';
  if (code.expiresAt && Date.parse(code.expiresAt) < now) return 'abgelaufen';
  return code.expiresAt ? `aktiv bis ${new Date(code.expiresAt).toLocaleString('de-AT')}` : 'aktiv';
}

// Login QR lifecycle (parity plan WP 2.6): list per event, unused filter, revoke per code.
export default function ShowUnusedLoginQrCodesPage() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<LoginQrCode[]>([]);
  const [events, setEvents] = useState<OperationScene[]>([]);
  const [eventSceneId, setEventSceneId] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [message, setMessage] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const { data } = await getLoginQrCodes({ unusedOnly, eventSceneId: eventSceneId ? Number(eventSceneId) : undefined });
      setCodes(data);
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Laden der Login-QR-Codes.'));
    } finally {
      setIsLoading(false);
    }
  }, [eventSceneId, unusedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getOperationScenes()
      .then(({ data }) => setEvents(data.filter((scene) => scene.parentSceneId == null)))
      .catch(() => setEvents([]));
  }, []);

  const eventName = (id: number) => events.find((scene) => scene.id === id)?.name ?? `Veranstaltung ${id}`;

  const handleRevoke = async (code: LoginQrCode) => {
    if (!window.confirm('Diesen Login-QR-Code widerrufen? Angemeldete Geräte verlieren sofort den Zugang.')) return;
    setMessage('');
    setErrorMessage('');
    try {
      await revokeLoginQrCode(code.id);
      setMessage('Login-QR-Code wurde widerrufen.');
      await load();
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Login-QR-Code konnte nicht widerrufen werden.'));
    }
  };

  // A used code stays a valid credential until it expires: only unused ones are printed again
  // (security review 2, finding 5).
  const printable = codes.filter((code) => !code.revokedAt && !code.firstLogin);
  const now = Date.now();

  return (
    <>
      <Appbar />
      <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
        <h2>Login-QR-Codes (Einsatzkräfte)</h2>
        <button onClick={() => navigate('/AdminSettingsPage')} style={{ marginBottom: '15px' }}>
          Zurück zu den Einstellungen
        </button>

        <div className="form-group">
          <label htmlFor="login-qr-event">Veranstaltung</label>
          <select id="login-qr-event" value={eventSceneId} onChange={(e) => setEventSceneId(e.target.value)}>
            <option value="">Alle</option>
            {events.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.name}</option>
            ))}
          </select>
        </div>
        <label>
          <input type="checkbox" checked={unusedOnly} onChange={(e) => setUnusedOnly(e.target.checked)} /> Nur unbenutzte
        </label>

        {message && <p className="msg-success" role="status">{message}</p>}
        {errorMessage && <p style={{ color: 'red', fontWeight: 'bold' }} role="alert">{errorMessage}</p>}

        {isLoading ? (
          <p role="status">Lade Login-QR-Codes...</p>
        ) : codes.length === 0 && !errorMessage ? (
          <p>Keine Login-QR-Codes vorhanden.</p>
        ) : (
          <>
            <table border={1} style={{ margin: '15px 0', width: '100%' }}>
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Veranstaltung</th>
                  <th>Gültigkeit (Stunden)</th>
                  <th>Status</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((code) => (
                  <tr key={code.id}>
                    <td>{code.id}</td>
                    <td>{eventName(code.eventSceneId)}</td>
                    <td>{code.expiresInHours ?? ''}</td>
                    <td>{codeStatus(code, now)}</td>
                    <td>
                      {!code.revokedAt && (
                        <button type="button" onClick={() => void handleRevoke(code)}>Widerrufen</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {printable.length > 0 && (
              <>
                <button
                  onClick={() => printRef.current && !printElement(printRef.current, 'Login-QR-Codes') && setErrorMessage('Druckfenster konnte nicht geöffnet werden.')}
                  style={{ marginBottom: '15px' }}
                >
                  Drucken ({printable.length})
                </button>
                <QrCodeSheet
                  ref={printRef}
                  items={printable.map((code) => ({ token: code.qrToken, caption: `Login-QR · ${eventName(code.eventSceneId)}` }))}
                />
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
