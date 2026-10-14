import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import QrCodeSheet from '../components/QrCodeSheet';
import { printElement } from '../utils/printElement';
import { generatePatientQRCodes } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';

export default function CreatePatientQrCodes() {
  const navigate = useNavigate();
  const [numberOfQrCodes, setNumberOfQrCodes] = useState<number>(1);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    setErrorMessage('');
    try {
      const { data } = await generatePatientQRCodes(numberOfQrCodes);
      setGeneratedCodes(data);
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Generieren der QR-Codes. Bitte versuchen Sie es erneut.'));
    } finally {
      setIsLoading(false);
    }
  };


  const handlePrint = () => {
    if (printRef.current && !printElement(printRef.current, 'Patienten QR-Codes')) setErrorMessage('Druckfenster konnte nicht geöffnet werden.');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Patienten QR-Codes erzeugen</h2>
      <form onSubmit={handleGenerate}>
        <div style={{ marginBottom: '15px' }}>
          <label htmlFor="numberOfQrCodes">Anzahl der QR-Codes:</label>
          <input
            type="number"
            id="numberOfQrCodes"
            min={1}
            max={100}
            value={numberOfQrCodes}
            onChange={(e) => setNumberOfQrCodes(parseInt(e.target.value, 10) || 1)}
            style={{ marginLeft: '10px', width: '80px' }}
          />
        </div>
        <button type="submit" disabled={isLoading}>
          {isLoading ? 'Generiere...' : 'QR-Codes generieren'}
        </button>
      </form>

      <button onClick={() => navigate('/AdminSettingsPage')} style={{ marginTop: '15px' }}>
        Zurück zu den Einstellungen
      </button>

      {errorMessage && (
        <p style={{ color: 'red', fontWeight: 'bold' }} role="alert">{errorMessage}</p>
      )}

      {generatedCodes.length > 0 && (
        <div>
          <button onClick={handlePrint} style={{ marginTop: '15px', marginBottom: '15px' }}>
            Drucken
          </button>
          <QrCodeSheet ref={printRef} items={generatedCodes.map((token) => ({ token, caption: 'Patienten-QR' }))} />
        </div>
      )}
    </div>
  );
}
