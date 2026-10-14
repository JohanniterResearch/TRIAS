import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OperationScene } from '../types';
import { getOperationScenes } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import { useWorkContextStore } from '../stores/workContextStore';
import Appbar from '../components/Appbar';

/**
 * Each event with its sub-sites (WP 2.5). A sub-site whose event is not listed (inactive, or out
 * of scope) forms its own group, so no accessible scene is hidden.
 */
function groupScenes(scenes: OperationScene[]) {
  const ids = new Set(scenes.map((scene) => scene.id));
  const roots = scenes.filter((scene) => scene.parentSceneId == null || !ids.has(scene.parentSceneId));
  return roots.map((event) => ({ event, sites: scenes.filter((scene) => scene.parentSceneId === event.id) }));
}

export default function RoleSelectionPage() {
  const [selectedRole, setSelectedRole] = useState('');
  const { operationSceneId: storedSceneId, setScene } = useWorkContextStore();
  const [selectedOperationScene, setSelectedOperationScene] = useState(storedSceneId ? String(storedSceneId) : '');
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [existingOperationScenes, setExistingOperationScenes] = useState<OperationScene[]>([]);

  const handleOptionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedOperationScene(event.target.value);
  };

  const handleRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedRole(event.target.value);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const operationSceneId = Number(selectedOperationScene);
    setScene(operationSceneId);
    // D8: "Leitstelle" keeps its label for every role; responders and QR sessions get the
    // Lagebild read-only (the server allows GET /api/persons for TriageWrite).
    switch (selectedRole.toUpperCase()) {
      case 'TRIAGE':
        navigate('/ScanPatient');
        break;
      case 'LEITSTELLE':
        navigate('/SituationRoomTable');
        break;
      default:
        navigate('/NotFound');
        break;
    }
  };

  useEffect(() => {
    const fetchExistingScenes = async () => {
      try {
        const { data } = await getOperationScenes();
        setExistingOperationScenes(data.filter((scene) => scene.active));
      } catch (error) {
        setErrorMessage(apiErrorMessage(error, 'Einsatzorte konnten nicht geladen werden. Bitte Seite neu laden.'));
      } finally {
        setLoading(false);
      }
    };
    fetchExistingScenes();
  }, []);

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '460px' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>Lade bestehende Einsatzorte...</p>
          ) : errorMessage ? (
            <div>
              <p className="msg-error" role="alert">{errorMessage}</p>
              <button onClick={() => window.location.reload()} className="btn-primary" style={{ marginBottom: '10px' }}>
                Erneut versuchen
              </button>
              <button onClick={() => navigate('/AdminLandingPage')} className="btn-secondary" style={{ width: '100%' }}>
                Zur Admin-Anmeldung
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <h2 style={{ marginBottom: '6px' }}>Rollenauswahl</h2>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem', marginBottom: '20px' }}>
                Wählen Sie Einsatzort und Funktion aus.
              </p>

              <div className="form-group">
                <label htmlFor="role-selection-scene">Einsatzort:</label>
                <select id="role-selection-scene" value={selectedOperationScene} onChange={handleOptionChange} required>
                  <option value="">Wähle einen Einsatzort aus</option>
                  {groupScenes(existingOperationScenes).map(({ event, sites }) => (
                    <optgroup key={event.id} label={event.name}>
                      {[event, ...sites].map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {scene.id === event.id ? `${scene.name} (Veranstaltung)` : scene.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="role-selection-role">Funktion:</label>
                <select id="role-selection-role" value={selectedRole} onChange={handleRoleChange} required>
                  <option value="">Rolle auswählen</option>
                  <option value="Triage">Triage</option>
                  <option value="Leitstelle">Leitstelle</option>
                </select>
              </div>

              <button type="submit" className="btn-primary" style={{ marginBottom: '10px' }}>
                Bestätigen
              </button>
              <button type="button" onClick={() => navigate('/AdminLandingPage')} className="btn-secondary" style={{ width: '100%' }}>
                Zur Admin-Anmeldung
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
