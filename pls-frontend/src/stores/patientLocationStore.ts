import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { updatePatientLocation } from '../api/endpoints';
import { offlineQueue, onPatientMapped, sendOrQueue } from '../offline/offlineQueue';
import { currentDraftOwner } from '../features/ambulanzprotokoll-page1/page1Storage';
import { STORAGE_KEYS } from '../storage/keys';

/** queued: stored on this device, sent by the offline queue (parity plan WP 6.3). */
export type PatientLocationJobStatus = 'locating' | 'writing' | 'written' | 'queued' | 'error';

export interface PatientLocationCoordinates {
  lat: number;
  lng: number;
  accuracyMeters?: number;
  /** When the device took the fix; sent as clientUpdatedAt (WP 3.4). */
  capturedAt?: string;
}

export interface PatientLocationJob {
  patientId: number;
  status: PatientLocationJobStatus;
  coordinates: PatientLocationCoordinates | null;
  error: string | null;
  updatedAt: string;
}

interface PatientLocationState {
  jobs: Record<number, PatientLocationJob>;
  ensurePatientLocation: (patientId: number | null | undefined) => Promise<void>;
  clearJobs: () => void;
}

const ACTIVE_JOB_STALE_MS = 30_000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Unbekannter Fehler bei der GPS-Ermittlung';
}

function requestCurrentPosition(): Promise<PatientLocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation wird von diesem Browser nicht unterstützt'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : undefined,
          capturedAt: new Date(Number.isFinite(position.timestamp) ? position.timestamp : Date.now()).toISOString(),
        });
      },
      (error) => reject(error),
      // A fix that never comes must not leave the job hanging (and arrive under a later session).
      { timeout: 60_000 }
    );
  });
}

function isStaleActiveJob(job: PatientLocationJob): boolean {
  if (job.status !== 'locating' && job.status !== 'writing') return false;
  const updatedAt = Date.parse(job.updatedAt);
  if (Number.isNaN(updatedAt)) return true;
  return Date.now() - updatedAt > ACTIVE_JOB_STALE_MS;
}

function buildJob(
  patientId: number,
  status: PatientLocationJobStatus,
  existing: PatientLocationJob | undefined,
  overrides: Partial<Pick<PatientLocationJob, 'coordinates' | 'error'>> = {}
): PatientLocationJob {
  return {
    patientId,
    status,
    coordinates: overrides.coordinates ?? existing?.coordinates ?? null,
    error: overrides.error ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export const usePatientLocationStore = create<PatientLocationState>()(
  persist(
    (set, get) => ({
      jobs: {},
      ensurePatientLocation: async (patientId) => {
        if (!patientId) return;

        const existing = get().jobs[patientId];
        if (existing && !isStaleActiveJob(existing)) return;

        set((state) => ({
          jobs: {
            ...state.jobs,
            [patientId]: buildJob(patientId, 'locating', existing),
          },
        }));

        try {
          // The fix belongs to the session that asked for it, not to whoever is signed in when
          // it arrives.
          const owner = currentDraftOwner();
          const coordinates = await requestCurrentPosition();

          set((state) => ({
            jobs: {
              ...state.jobs,
              [patientId]: buildJob(patientId, 'writing', state.jobs[patientId], { coordinates }),
            },
          }));

          const { capturedAt, ...fix } = coordinates;
          const body = { ...fix, source: 'gps' as const, clientUpdatedAt: capturedAt };
          const outcome = await sendOrQueue(
            patientId,
            (sessionOwner) => updatePatientLocation(patientId, body, { expectedOwner: sessionOwner }),
            (sessionOwner) => offlineQueue.queueLocation(patientId, body, sessionOwner),
            owner,
          );

          set((state) => ({
            jobs: {
              ...state.jobs,
              [patientId]: buildJob(patientId, outcome.queued ? 'queued' : 'written', state.jobs[patientId], { coordinates }),
            },
          }));
        } catch (error) {
          set((state) => ({
            jobs: {
              ...state.jobs,
              [patientId]: buildJob(patientId, 'error', state.jobs[patientId], {
                error: getErrorMessage(error),
              }),
            },
          }));
        }
      },
      clearJobs: () => set({ jobs: {} }),
    }),
    {
      name: STORAGE_KEYS.patientLocation,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ jobs: state.jobs }),
    }
  )
);

// A provisional patient got its server id (WP 6.4): its job follows it.
onPatientMapped((provisionalId, patient) => {
  usePatientLocationStore.setState((state) => {
    const job = state.jobs[provisionalId];
    if (!job) return state;
    const rest = Object.fromEntries(Object.entries(state.jobs).filter(([id]) => Number(id) !== provisionalId));
    return { jobs: { ...rest, [patient.id]: { ...job, patientId: patient.id } } };
  });
});
