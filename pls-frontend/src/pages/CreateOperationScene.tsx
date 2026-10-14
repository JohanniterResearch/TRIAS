import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOperationScenes, saveOperationScene, type OperationScene } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import Appbar from '../components/Appbar';
import SceneFields from '../components/SceneFields';
import { EMPTY_SCENE, draftToBody, sceneDraftError, type SceneDraft } from '../utils/sceneDraft';

export default function CreateOperationScene() {
  const [draft, setDraft] = useState<SceneDraft>(EMPTY_SCENE);
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSuccessMessage('');
    setErrorMessage('');
    const invalid = sceneDraftError(draft);
    if (invalid) {
      setErrorMessage(invalid);
      return;
    }
    setIsLoading(true);
    try {
      const { data } = await saveOperationScene(draftToBody(draft));
      setSuccessMessage('Einsatzort wurde erfolgreich erstellt.');
      if (data.parentSceneId == null) setEvents((prev) => [...prev, data]);
      setDraft(EMPTY_SCENE);
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Erstellen des Einsatzortes. Bitte versuchen Sie es erneut.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '500px' }}>
          <h2>Neuen Einsatzort erstellen</h2>
          <p>Ohne übergeordnete Veranstaltung ist der neue Einsatzort selbst eine Veranstaltung.</p>

          {successMessage && <p className="msg-success" role="status">{successMessage}</p>}
          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: '16px' }}>
            <SceneFields draft={draft} onChange={setDraft} events={events} />
            <button type="submit" disabled={isLoading} className="btn-primary">
              {isLoading ? 'Erstelle...' : 'Einsatzort erstellen'}
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
