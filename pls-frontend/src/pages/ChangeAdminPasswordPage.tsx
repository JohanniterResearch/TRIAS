import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginPathFor, useAuthStore } from '../stores/authStore';
import { useWorkContextStore } from '../stores/workContextStore';
import { changePassword } from '../api/endpoints';
import { apiErrorMessage, httpStatus } from '../api/client';
import Appbar from '../components/Appbar';

export default function ChangeAdminPasswordPage() {
  const session = useAuthStore((state) => state.session);
  const username = session?.username ?? '';
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    newPasswordConfirmation: '',
  });
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleInputChange = ({ target }: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSuccessMessage('');
    setErrorMessage('');

    if (formData.newPassword !== formData.newPasswordConfirmation) {
      setErrorMessage('Die neuen Passwörter stimmen nicht überein.');
      return;
    }

    if (formData.newPassword.length < 8) {
      setErrorMessage('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    setIsLoading(true);

    try {
      await changePassword({ username, password: formData.currentPassword, newPassword: formData.newPassword });
      // The server invalidates every token of the account; sign in again with the new password.
      const role = session?.role;
      useAuthStore.getState().clearSession();
      useWorkContextStore.getState().clear();
      navigate(loginPathFor(role), {
        state: { successMessage: 'Passwort wurde erfolgreich geändert. Bitte erneut anmelden.' },
      });
    } catch (error) {
      setErrorMessage(httpStatus(error) === 401
        ? 'Aktuelles Passwort ist falsch.'
        : apiErrorMessage(error, 'Fehler beim Ändern des Passworts. Bitte versuchen Sie es erneut.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '460px' }}>
          <h2>Passwort ändern</h2>
          <p>Ändern Sie das Passwort für: <strong>{username}</strong></p>

          {successMessage && <p className="msg-success" role="status">{successMessage}</p>}
          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          <form onSubmit={handleSubmit} style={{ marginTop: '16px' }}>
            <div className="form-group">
              <label htmlFor="currentPassword">Aktuelles Passwort:</label>
              <input
                type="password"
                id="currentPassword"
                name="currentPassword"
                value={formData.currentPassword}
                onChange={handleInputChange}
                placeholder="Aktuelles Passwort eingeben"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPassword">Neues Passwort:</label>
              <input
                type="password"
                id="newPassword"
                name="newPassword"
                value={formData.newPassword}
                onChange={handleInputChange}
                placeholder="Neues Passwort eingeben (mind. 8 Zeichen)"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="newPasswordConfirmation">Neues Passwort bestätigen:</label>
              <input
                type="password"
                id="newPasswordConfirmation"
                name="newPasswordConfirmation"
                value={formData.newPasswordConfirmation}
                onChange={handleInputChange}
                placeholder="Neues Passwort bestätigen"
                required
              />
            </div>
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? 'Ändere...' : 'Passwort ändern'}
            </button>
          </form>

          <button onClick={() => navigate('/')} className="btn-secondary" style={{ marginTop: '12px', width: '100%' }}>
            Zurück zu den Einstellungen
          </button>
        </div>
      </div>
    </>
  );
}
