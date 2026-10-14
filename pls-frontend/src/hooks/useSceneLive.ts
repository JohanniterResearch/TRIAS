import { useCallback, useEffect, useRef, useState } from 'react';
import { getPersons, getTeams, type Patient, type Team } from '../api/endpoints';
import { apiErrorMessage } from '../api/client';
import { connectScene, type ConnectionState } from '../realtime/sceneRealtime';
import { useAuthStore } from '../stores/authStore';

export const POLL_INTERVAL_MS = 10_000;

/** Regions of one patient and when this client received them (newest source wins on display). */
export interface ReceivedBodyParts {
  regions: Record<string, number>;
  receivedAt: number;
}

const upsert = <T extends { id: number }>(list: T[], item: T) =>
  list.some((entry) => entry.id === item.id) ? list.map((entry) => (entry.id === item.id ? item : entry)) : [...list, item];

/**
 * Live Lagebild state for one scene (WP 5.1): realtime snapshot and upserts while the hub is
 * connected, GET /api/persons and /api/teams every 10 s while it is not.
 */
export function useSceneLive(sceneId: number | null) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [bodyParts, setBodyParts] = useState<Record<number, ReceivedBodyParts>>({});
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Another scene: nothing of the previous one stays on screen, even if the first load fails
  // (security review 3, L3). Reset during render, the React pattern for state tied to a prop.
  const [shownScene, setShownScene] = useState(sceneId);
  if (shownScene !== sceneId) {
    setShownScene(sceneId);
    setPatients([]);
    setTeams([]);
    setBodyParts({});
    setError(null);
    setLoading(true);
  }
  const sceneRef = useRef(sceneId);
  // While the hub delivers, a slower HTTP answer must not overwrite newer pushed state.
  const liveRef = useRef(false);

  /** Loads the scene over HTTP; true when the answer was applied. */
  const poll = useCallback(async (): Promise<boolean> => {
    if (!sceneId) return false;
    try {
      const [persons, sceneTeams] = await Promise.all([getPersons(sceneId), getTeams(sceneId)]);
      if (sceneRef.current !== sceneId || liveRef.current) return false;
      setPatients(persons.data);
      setTeams(sceneTeams.data);
      setError(null);
      return true;
    } catch (cause) {
      if (sceneRef.current === sceneId) setError(apiErrorMessage(cause, 'Patienten konnten nicht geladen werden.'));
      return false;
    } finally {
      if (sceneRef.current === sceneId) setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => {
    sceneRef.current = sceneId;
    liveRef.current = false;
    if (!sceneId) return;
    void poll(); // first paint does not wait for the hub
    // Only messages of this scene are applied, whatever the server sends.
    const ours = (payload: { sceneId: number }) => payload.sceneId === sceneId && sceneRef.current === sceneId;
    return connectScene(sceneId, () => useAuthStore.getState().session?.token ?? '', {
      onSnapshot: (snapshot) => {
        if (!ours(snapshot)) return;
        liveRef.current = true;
        setPatients(snapshot.patients);
        setTeams(snapshot.teams);
        setLoading(false);
        setError(null);
      },
      onPatient: (update) => {
        if (!ours(update)) return;
        setPatients((list) => upsert(list, update.patient));
        if (update.bodyParts) setBodyParts((map) => ({ ...map, [update.patient.id]: { regions: update.bodyParts!, receivedAt: Date.now() } }));
      },
      onTeam: (update) => {
        if (ours(update)) setTeams((list) => upsert(list, update.team));
      },
      // Membership changed (creation, move): the list is refetched, the API stays authoritative.
      onPatientList: (list) => {
        if (!ours(list)) return;
        liveRef.current = false;
        // Live again only if the refetch landed; otherwise polling stays in charge.
        void poll().then((applied) => {
          if (applied && sceneRef.current === sceneId) liveRef.current = true;
        });
      },
      onState: (state) => {
        if (state !== 'connected') liveRef.current = false;
        setConnection(state);
      },
    });
  }, [poll, sceneId]);

  useEffect(() => {
    if (!sceneId || connection === 'connected') return;
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connection, poll, sceneId]);

  const applyTeam = useCallback((team: Team) => setTeams((list) => upsert(list, team)), []);

  return { patients, teams, bodyParts, connection, loading, error, applyTeam };
}
