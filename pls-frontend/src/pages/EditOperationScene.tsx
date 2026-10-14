import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { OperationScene } from '../types';
import { getOperationScenes, saveOperationScene, deleteOperationScene } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import Appbar from '../components/Appbar';
import SceneFields from '../components/SceneFields';
import { EMPTY_SCENE, draftToBody, sceneDraftError, sceneToDraft, type SceneDraft } from '../utils/sceneDraft';

export default function EditOperationScene() {
  const [operationScenes, setOperationScenes] = useState<OperationScene[]>([]);
  const [selectedScene, setSelectedScene] = useState<OperationScene | null>(null);
  const [draft, setDraft] = useState<SceneDraft>(EMPTY_SCENE);
  const [isLoading, setIsLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const isAdmin = useAuthStore((state) => state.session?.role === 'admin');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchScenes = async () => {
      try {
        const { data } = await getOperationScenes();
        setOperationScenes(data);
      } catch (error) {
        setErrorMessage(apiErrorMessage(error, 'Fehler beim Laden der Einsatzorte.'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchScenes();
  }, []);

  const handleSceneSelect = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const sceneId = parseInt(event.target.value, 10);
    const scene = operationScenes.find((s) => s.id === sceneId) || null;
    setSelectedScene(scene);
    setDraft(scene ? sceneToDraft(scene) : EMPTY_SCENE);
    setSuccessMessage('');
    setErrorMessage('');
  };

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedScene) return;
    setSuccessMessage('');
    setErrorMessage('');
    const invalid = sceneDraftError(draft);
    if (invalid) {
      setErrorMessage(invalid);
      return;
    }

    try {
      const { data } = await saveOperationScene(draftToBody(draft, selectedScene.id));
      setSuccessMessage('Einsatzort wurde erfolgreich aktualisiert.');
      setSelectedScene(data);
      setOperationScenes((prev) => prev.map((s) => (s.id === data.id ? data : s)));
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Aktualisieren. Bitte versuchen Sie es erneut.'));
    }
  };

  const handleDelete = async () => {
    if (!selectedScene) return;
    if (!window.confirm(`Einsatzort "${selectedScene.name}" wirklich löschen?`)) return;
    setSuccessMessage('');
    setErrorMessage('');

    try {
      await deleteOperationScene(selectedScene.id);
      setSuccessMessage('Einsatzort wurde erfolgreich gelöscht.');
      setOperationScenes((prev) => prev.filter((s) => s.id !== selectedScene.id));
      setSelectedScene(null);
      setDraft(EMPTY_SCENE);
    } catch (error) {
      // 409: linked patients, sub-sites or accounts block deletion; the server says which.
      setErrorMessage(apiErrorMessage(error, 'Fehler beim Löschen. Bitte versuchen Sie es erneut.'));
    }
  };

  if (isLoading) return <><Appbar /><div className="auth-page"><p>Lade Einsatzorte...</p></div></>;

  return (
    <>
      <Appbar />
      <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px' }}>
        <div className="auth-card" style={{ maxWidth: '500px' }}>
          <h2>Einsatzort bearbeiten</h2>
          <p style={{ marginBottom: '0' }}></p>

          {successMessage && <p className="msg-success" role="status">{successMessage}</p>}
          {errorMessage && <p className="msg-error" role="alert">{errorMessage}</p>}

          <div style={{ marginTop: '16px' }}>
            {operationScenes.length === 0 ? (
              <p style={{ color: 'rgba(255,255,255,0.5)' }}>Keine Einsatzorte vorhanden.</p>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="sceneSelect">Einsatzort auswählen:</label>
                  <select
                    id="sceneSelect"
                    value={selectedScene?.id || ''}
                    onChange={handleSceneSelect}
                  >
                    <option value="">-- Einsatzort wählen --</option>
                    {operationScenes.map((scene) => (
                      <option key={scene.id} value={scene.id}>
                        {scene.parentSceneId == null ? scene.name : `${scene.name} (Unterort)`}
                        {scene.active ? '' : ' – inaktiv'}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedScene && (
                  <form onSubmit={handleUpdate}>
                    <SceneFields
                      draft={draft}
                      onChange={setDraft}
                      events={operationScenes.filter((scene) => scene.parentSceneId == null)}
                      editingId={selectedScene.id}
                      hasSubSites={operationScenes.some((scene) => scene.parentSceneId === selectedScene.id)}
                    />
                    <button type="submit" className="btn-primary">
                      Einsatzort aktualisieren
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="btn-danger"
                        style={{ marginTop: '10px', width: '100%' }}
                      >
                        Einsatzort löschen
                      </button>
                    )}
                  </form>
                )}
              </>
            )}
          </div>

          <button
            onClick={() => navigate('/CreateOperationScene')}
            className="btn-secondary"
            style={{ marginTop: '16px', width: '100%' }}
          >
            Neuen Einsatzort erstellen
          </button>
          <button
            onClick={() => navigate('/AdminSettingsPage')}
            className="btn-secondary"
            style={{ marginTop: '8px', width: '100%' }}
          >
            Zurück zu den Einstellungen
          </button>
        </div>
      </div>
    </>
  );
}
