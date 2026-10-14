import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import QrCodeSheet from '../components/QrCodeSheet';
import { printElement } from '../utils/printElement';
import { getUnusedPatientQrCodes } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';

export default function ShowUnusedPatientQrCodesPage() {
  const navigate = useNavigate();
  const [unusedCodes, setUnusedCodes] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchUnusedCodes = async () => {
      try {
        const { data } = await getUnusedPatientQrCodes();
        setUnusedCodes(data);
      } catch (error) {
        setErrorMessage(apiErrorMessage(error, 'Fehler beim Laden der nicht verwendeten QR-Codes.'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchUnusedCodes();
  }, []);


  const handlePrint = () => {
    if (printRef.current && !printElement(printRef.current, 'Nicht verwendete Patienten QR-Codes')) setErrorMessage('Druckfenster konnte nicht geöffnet werden.');
  };

  if (isLoading) return <p>Lade nicht verwendete Patienten QR-Codes...</p>;

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Nicht verwendete Patienten QR-Codes</h2>
      <button onClick={() => navigate('/AdminSettingsPage')} style={{ marginBottom: '15px' }}>
        Zurück zu den Einstellungen
      </button>

      {errorMessage && (
        <p style={{ color: 'red', fontWeight: 'bold' }} role="alert">{errorMessage}</p>
      )}

      {unusedCodes.length === 0 && !errorMessage ? (
        <p>Keine nicht verwendeten Patienten QR-Codes vorhanden.</p>
      ) : (
        <div>
          <p>Anzahl: {unusedCodes.length}</p>
          <button onClick={handlePrint} style={{ marginBottom: '15px' }}>
            Drucken
          </button>
          <QrCodeSheet ref={printRef} items={unusedCodes.map((token) => ({ token, caption: 'Patienten-QR' }))} />
        </div>
      )}
    </div>
  );
}
