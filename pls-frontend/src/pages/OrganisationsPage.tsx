import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Appbar from '../components/Appbar';
import { createOrganisation, getOrganisations, type Organisation } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';

// WP 2.3: organisations are listed and created here and assigned in the scene editor.
export default function OrganisationsPage() {
  const navigate = useNavigate();
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    getOrganisations()
      .then(({ data }) => setOrganisations(data))
      .catch((error) => setErrorMessage(apiErrorMessage(error, 'Organisationen konnten nicht geladen werden.')))
      .finally(() => setIsLoading(false));
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setErrorMessage('');
    try {
      const { data } = await createOrganisation(name.trim());
      setOrganisations((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'de')));
      setName('');
      setMessage(`Organisation "${data.name}" wurde erstellt.`);
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Organisation konnte nicht erstellt werden.'));
    }
  };

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '500px' }}>
          <h2>Organisationen</h2>
          {message && <p className="msg-success" role="status">{message}</p>}
          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          {isLoading ? (
            <p role="status">Lade Organisationen...</p>
          ) : organisations.length === 0 ? (
            <p>Keine Organisationen vorhanden.</p>
          ) : (
            <ul aria-label="Organisationen">
              {organisations.map((organisation) => (
                <li key={organisation.id}>{organisation.name}</li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void handleCreate(e)} style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label htmlFor="organisation-name">Neue Organisation</label>
              <input id="organisation-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary" disabled={!name.trim()}>Organisation erstellen</button>
          </form>

          <button onClick={() => navigate('/AdminSettingsPage')} className="btn-secondary" style={{ marginTop: '12px', width: '100%' }}>
            Zurück zu den Einstellungen
          </button>
        </div>
      </div>
    </>
  );
}
