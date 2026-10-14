import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUser, getOperationScenes, type Body, type OperationScene } from '../api/endpoints';
import { apiErrorMessage, httpStatus } from '../api/client';
import Appbar from '../components/Appbar';

type NewUser = Body<'/api/users', 'post'>;

const ROLE_LABELS: Record<NewUser['role'], string> = { admin: 'Admin', leitstelle: 'Leitstelle', responder: 'Einsatzkraft' };

// WP 2.1: Admin creates Admin, Leitstelle and responder accounts. Event accounts are scoped to one
// top-level event and its access window; the password policy is enforced by the server.
export default function CreateNewAdminUserPage() {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    passwordConfirmation: '',
  });
  const [role, setRole] = useState<NewUser['role']>('responder');
  const [accountType, setAccountType] = useState<'permanent' | 'event'>('permanent');
  const [eventSceneId, setEventSceneId] = useState('');
  const [events, setEvents] = useState<OperationScene[]>([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getOperationScenes()
      .then(({ data }) => setEvents(data.filter((scene) => scene.parentSceneId == null)))
      .catch((error) => setErrorMessage(apiErrorMessage(error, 'Veranstaltungen konnten nicht geladen werden.')));
  }, []);

  const handleInputChange = ({ target }: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSuccessMessage('');
    setErrorMessage('');

    if (formData.password !== formData.passwordConfirmation) {
      setErrorMessage('Die Passwörter stimmen nicht überein.');
      return;
    }

    setIsLoading(true);

    try {
      const isEvent = role !== 'admin' && accountType === 'event';
      await createUser({
        username: formData.username,
        password: formData.password,
        role,
        accountType: isEvent ? 'event' : 'permanent',
        eventSceneId: isEvent ? Number(eventSceneId) : undefined,
      });
      setSuccessMessage(`${ROLE_LABELS[role]}-Benutzer wurde erfolgreich erstellt.`);
      setFormData({ username: '', password: '', passwordConfirmation: '' });
    } catch (error) {
      setErrorMessage(httpStatus(error) === 409
        ? 'Benutzername existiert bereits.'
        : apiErrorMessage(error, 'Fehler beim Erstellen des Benutzers. Bitte versuchen Sie es erneut.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '460px' }}>
          <h2>Neuen Benutzer erstellen</h2>
          <p>Admin- und Leitstelle-Benutzer müssen das Passwort bei der ersten Anmeldung ändern.</p>

          {successMessage && <p className="msg-success" role="status">{successMessage}</p>}
          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label htmlFor="role">Rolle:</label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value as NewUser['role'])}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            {role !== 'admin' && (
              <div className="form-group">
                <label htmlFor="accountType">Kontotyp:</label>
                <select id="accountType" value={accountType} onChange={(e) => setAccountType(e.target.value as 'permanent' | 'event')}>
                  <option value="permanent">Dauerhaft</option>
                  <option value="event">Veranstaltung</option>
                </select>
              </div>
            )}
            {role !== 'admin' && accountType === 'event' && (
              <div className="form-group">
                <label htmlFor="eventSceneId">Veranstaltung:</label>
                <select id="eventSceneId" value={eventSceneId} onChange={(e) => setEventSceneId(e.target.value)} required>
                  <option value="">Veranstaltung auswählen</option>
                  {events.map((scene) => (
                    <option key={scene.id} value={scene.id}>{scene.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label htmlFor="username">Benutzername:</label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Benutzernamen eingeben"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Passwort:</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Passwort eingeben"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="passwordConfirmation">Passwort bestätigen:</label>
              <input
                type="password"
                id="passwordConfirmation"
                name="passwordConfirmation"
                value={formData.passwordConfirmation}
                onChange={handleInputChange}
                placeholder="Passwort bestätigen"
                required
              />
            </div>
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? 'Erstelle...' : 'Benutzer erstellen'}
            </button>
          </form>

          <button onClick={() => navigate('/AdminSettingsPage')} className="btn-secondary" style={{ marginTop: '12px', width: '100%' }}>
            Zurück zu den Einstellungen
          </button>
        </div>
      </div>
    </>
  );
}
