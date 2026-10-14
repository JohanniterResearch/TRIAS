import { useEffect, useState } from 'react';
import { getOrganisations, type OperationScene, type Organisation } from '../api/endpoints';
import type { SceneDraft } from '../utils/sceneDraft';
import { useAuthStore } from '../stores/authStore';

interface Props {
  draft: SceneDraft;
  onChange: (draft: SceneDraft) => void;
  /** Top-level events that can be chosen as parent. */
  events: OperationScene[];
  /** The scene being edited: it can be neither its own parent nor a sub-site while it has some. */
  editingId?: number;
  hasSubSites?: boolean;
}

// Scene editor fields (parity plan WP 2.3, 2.5). Organisations are Admin-only on the server, so a
// Leitstelle sees the current assignment read-only and the form sends it back unchanged.
export default function SceneFields({ draft, onChange, events, editingId, hasSubSites = false }: Props) {
  const isAdmin = useAuthStore((state) => state.session?.role === 'admin');
  const [organisations, setOrganisations] = useState<Organisation[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    getOrganisations()
      .then(({ data }) => setOrganisations(data))
      .catch(() => setOrganisations([]));
  }, [isAdmin]);

  const set = <K extends keyof SceneDraft>(key: K, value: SceneDraft[K]) => onChange({ ...draft, [key]: value });
  const parents = events.filter((scene) => scene.id !== editingId);

  return (
    <>
      <div className="form-group">
        <label htmlFor="scene-name">Name des Einsatzorts:</label>
        <input id="scene-name" value={draft.name} maxLength={255} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="scene-description">Beschreibung:</label>
        <textarea id="scene-description" value={draft.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="scene-parent">Übergeordnete Veranstaltung:</label>
        <select id="scene-parent" value={draft.parentSceneId} onChange={(e) => set('parentSceneId', e.target.value)} disabled={hasSubSites}>
          <option value="">Keine (Einsatzort ist selbst eine Veranstaltung)</option>
          {parents.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.name}</option>
          ))}
        </select>
        {hasSubSites && <small>Hat eigene Unterorte und bleibt deshalb eine Veranstaltung.</small>}
      </div>
      <div className="form-group">
        <label htmlFor="scene-organisation">Organisation:</label>
        {isAdmin ? (
          <select id="scene-organisation" value={draft.organisationId} onChange={(e) => set('organisationId', e.target.value)}>
            <option value="">Keine</option>
            {organisations.map((organisation) => (
              <option key={organisation.id} value={organisation.id}>{organisation.name}</option>
            ))}
          </select>
        ) : (
          <input id="scene-organisation" value={draft.organisationId ? `Organisation ${draft.organisationId}` : 'Keine'} readOnly />
        )}
      </div>
      <div className="form-group">
        <label htmlFor="scene-window-start">Zugriff ab:</label>
        <input id="scene-window-start" type="datetime-local" value={draft.accessWindowStart} onChange={(e) => set('accessWindowStart', e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="scene-window-end">Zugriff bis:</label>
        <input id="scene-window-end" type="datetime-local" value={draft.accessWindowEnd} onChange={(e) => set('accessWindowEnd', e.target.value)} />
      </div>
      <label className="form-group">
        <input type="checkbox" checked={draft.active} onChange={(e) => set('active', e.target.checked)} /> Aktiv
      </label>
    </>
  );
}
