import type { Body, OperationScene } from '../api/endpoints';

export interface SceneDraft {
  name: string;
  description: string;
  organisationId: string;
  parentSceneId: string;
  accessWindowStart: string;
  accessWindowEnd: string;
  active: boolean;
}

export const EMPTY_SCENE: SceneDraft = {
  name: '',
  description: '',
  organisationId: '',
  parentSceneId: '',
  accessWindowStart: '',
  accessWindowEnd: '',
  active: true,
};

/** ISO instant -> value of an <input type="datetime-local"> in local time. */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function sceneToDraft(scene: OperationScene): SceneDraft {
  return {
    name: scene.name,
    description: scene.description ?? '',
    organisationId: scene.organisationId == null ? '' : String(scene.organisationId),
    parentSceneId: scene.parentSceneId == null ? '' : String(scene.parentSceneId),
    accessWindowStart: toLocalInput(scene.accessWindowStart),
    accessWindowEnd: toLocalInput(scene.accessWindowEnd),
    active: scene.active,
  };
}

/**
 * The full upsert body. The server replaces every field (an absent one is cleared), so the form
 * always sends all of them.
 */
export function draftToBody(draft: SceneDraft, id?: number): Body<'/api/operation-scenes', 'post'> {
  const instant = (value: string) => (value ? new Date(value).toISOString() : undefined);
  const number = (value: string) => (value ? Number(value) : undefined);
  return {
    id,
    name: draft.name.trim(),
    description: draft.description,
    organisationId: number(draft.organisationId),
    parentSceneId: number(draft.parentSceneId),
    accessWindowStart: instant(draft.accessWindowStart),
    accessWindowEnd: instant(draft.accessWindowEnd),
    active: draft.active,
  };
}

/** Client-side check before sending; the server validates again (nesting, cycles). */
export function sceneDraftError(draft: SceneDraft): string | null {
  if (!draft.name.trim()) return 'Name ist erforderlich.';
  if (draft.accessWindowStart && draft.accessWindowEnd && new Date(draft.accessWindowEnd) <= new Date(draft.accessWindowStart)) {
    return 'Das Ende des Zugriffsfensters muss nach dem Beginn liegen.';
  }
  return null;
}
