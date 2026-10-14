import { useEffect, useRef, useState } from 'react';
import { getBodyParts, saveBodyPart } from '../api/endpoints';
import { apiErrorMessage, isUnavailable } from '../api/client';
import { isProvisional, offlineQueue, sendOrQueue } from '../offline/offlineQueue';
import {
  decodeBodyParts,
  isSharedRegion,
  markedWithoutPlsRegion,
  plsKeysFor,
  toAmbulanzRegion,
  type PlsBodyKey,
} from '../api/codecs/bodyMap';
import { STORAGE_KEYS } from '../storage/keys';

/** What this device still has to send for the patient, applied over the loaded regions in order. */
async function withQueuedMarks(patientId: number, loaded: Record<string, number>): Promise<Record<string, number>> {
  const marks = { ...loaded };
  const queued = (await offlineQueue.pendingFor(patientId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const item of queued) if (item.type === 'body-part') marks[item.body.bodyPartId] = item.body.isClicked ? 1 : 0;
  return marks;
}

function hintAlreadySeen() {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.bodyMapHintSeen) === '1';
  } catch {
    return false;
  }
}

// Body map through the region codec (parity plan D4/D10, Section 5.2). The server stores
// Ambulanzsystem regions; a tap on a PLS region sets its mapped region, which highlights every
// PLS region of that group, and clearing any of them clears the group.
export function useBodyMap(patientId: number | null) {
  const [server, setServer] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  // The server's marks could not be read: what is shown is only what was marked here.
  const [partial, setPartial] = useState(false);
  // Only the newest tap's server answer replaces the map; an older answer arriving late would
  // hide a mark made after it (final review L3).
  const latestTap = useRef(0);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    // A patient only on this device, or an unreachable server: start from an empty map; the
    // marks are queued and the server merges them per region.
    // Marks this device queued are shown on top (final review M3), so a mark made offline can
    // be seen and cleared again before it is sent.
    const show = async (loaded: Record<string, number>, serverUnknown: boolean) => {
      const marks = await withQueuedMarks(patientId, loaded);
      if (!active) return;
      setServer(marks);
      setPartial(serverUnknown);
    };
    if (isProvisional(patientId)) {
      void show({}, false);
      return () => {
        active = false;
      };
    }
    getBodyParts(patientId)
      .then(({ data }) => show(data.bodyParts, false))
      .catch((cause) => {
        if (!active) return;
        if (isUnavailable(cause)) void show({}, true);
        else setError(apiErrorMessage(cause, 'Körperregionen konnten nicht geladen werden.'));
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  const toggle = async (plsKey: PlsBodyKey, isClicked: boolean) => {
    if (!patientId) return;
    setError(null);
    if (isSharedRegion(plsKey) && !hintAlreadySeen()) {
      const group = plsKeysFor(toAmbulanzRegion(plsKey)).join(', ');
      setHint(`Diese Regionen werden gemeinsam gespeichert und gemeinsam markiert oder gelöscht: ${group}.`);
      try {
        window.localStorage.setItem(STORAGE_KEYS.bodyMapHintSeen, '1');
      } catch {
        // Hint shows again next time; harmless.
      }
    }
    const region = toAmbulanzRegion(plsKey);
    const tap = ++latestTap.current;
    try {
      const outcome = await sendOrQueue(
        patientId,
        (owner) => saveBodyPart(patientId, region, isClicked, { expectedOwner: owner }),
        (owner) => offlineQueue.queueBodyPart(patientId, { idpatient: patientId, bodyPartId: region, isClicked }, owner),
      );
      // Queued: shown at once, the server stores it when the queue sends it.
      setServer((current) =>
        outcome.queued || tap !== latestTap.current ? { ...current, [region]: isClicked ? 1 : 0 } : outcome.result.data.bodyParts,
      );
    } catch (cause) {
      setError(apiErrorMessage(cause, 'Körperregion konnte nicht gespeichert werden. Bitte erneut versuchen.'));
    }
  };

  return {
    loading: Boolean(patientId) && server === null && error === null,
    marked: server ? decodeBodyParts(server) : null,
    undrawable: server ? markedWithoutPlsRegion(server) : [],
    toggle,
    error: patientId ? error : 'Kein Patient ausgewählt.',
    hint,
    offlineNote: partial ? 'Server nicht erreichbar: bereits gespeicherte Regionen werden nicht angezeigt. Neue Markierungen werden gesendet, sobald eine Verbindung besteht.' : null,
  };
}
