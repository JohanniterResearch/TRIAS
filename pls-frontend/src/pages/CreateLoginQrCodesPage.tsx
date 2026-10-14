import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateLoginQRCodes, getOperationScenes, type OperationScene } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import Appbar from '../components/Appbar';
import QrCodeSheet from '../components/QrCodeSheet';
import { printElement } from '../utils/printElement';

export default function CreateLoginQrCodesPage() {
  const navigate = useNavigate();
  const [numberOfQrCodes, setNumberOfQrCodes] = useState<number>(1);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [events, setEvents] = useState<OperationScene[]>([]);
  const [eventSceneId, setEventSceneId] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(12);
  const printRef = useRef<HTMLDivElement>(null);

  // Login QR codes grant access to one top-level event and its sub-sites (FR-AUTH-08).
  useEffect(() => {
    getOperationScenes()
      .then(({ data }) => setEvents(data.filter((scene) => scene.parentSceneId == null && scene.active)))
      .catch((error) => setErrorMessage(apiErrorMessage(error, 'Veranstaltungen konnten nicht geladen werden.')));
  }, []);

  const handlePrint = () => {
    if (printRef.current && !printElement(printRef.current, 'Login-QR-Codes')) setErrorMessage('Druckfenster konnte nicht geöffnet werden.');
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    try {
      const { data } = await generateLoginQRCodes({ number: numberOfQrCodes, eventSceneId: Number(eventSceneId), expiresInHours });
      setGeneratedCodes(data.map((code) => code.qrToken));
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Generieren der QR-Codes. Bitte versuchen Sie es erneut.'));
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '520px' }}>
          <h2>QR-Codes für die Authentifizierung generieren</h2>
          <p>Wählen Sie die Anzahl der zu generierenden QR-Codes aus.</p>

          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          <form onSubmit={handleGenerate} style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label htmlFor="eventSceneId">Veranstaltung</label>
              <select id="eventSceneId" value={eventSceneId} onChange={(e) => setEventSceneId(e.target.value)} required>
                <option value="">Veranstaltung auswählen</option>
                {events.map((scene) => (
                  <option key={scene.id} value={scene.id}>{scene.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="expiresInHours">Gültigkeit ab erster Anmeldung (Stunden)</label>
              <input
                type="number"
                id="expiresInHours"
                min={1}
                max={168}
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value) || 12)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="numberOfQrCodes">Anzahl</label>
              <input
                type="number"
                id="numberOfQrCodes"
                min={1}
                max={100}
                value={numberOfQrCodes}
                onChange={(e) => setNumberOfQrCodes(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', marginBottom: '16px' }}>
              Geben Sie die gewünschte Anzahl an QR-Codes ein und klicken Sie auf &quot;Generieren&quot;.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={isLoading} className="btn-primary">
                {isLoading ? 'Generiere...' : 'QR-Codes generieren'}
              </button>
              {generatedCodes.length > 0 && (
                <button type="button" onClick={handlePrint} className="btn-secondary" style={{ whiteSpace: 'nowrap' }}>
                  Als PDF drucken
                </button>
              )}
            </div>
          </form>

          <button onClick={() => navigate('/AdminSettingsPage')} className="btn-secondary" style={{ marginTop: '12px', width: '100%' }}>
            Zurück zu den Einstellungen
          </button>
        </div>
      </div>

      {generatedCodes.length > 0 && (
        <div className="page">
          <QrCodeSheet
            ref={printRef}
            items={generatedCodes.map((token) => ({
              token,
              caption: `Login-QR · ${events.find((scene) => scene.id === Number(eventSceneId))?.name ?? ''}`,
            }))}
          />
        </div>
      )}
    </>
  );
}
