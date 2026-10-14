import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { STORAGE_KEYS } from '../storage/keys';

// The chosen scene and the patient being worked on survive a page reload (parity plan WP 1.4);
// before, they lived only in router location.state and a reload lost them.
interface WorkContextState {
  operationSceneId: number | null;
  patientId: number | null;
  /** Readable number of a manually created patient (FR-PAT-07); null for QR patients. */
  patientLabel: string | null;
  setScene: (operationSceneId: number) => void;
  setPatient: (patientId: number | null, patientLabel?: string | null) => void;
  clear: () => void;
}

export const useWorkContextStore = create<WorkContextState>()(
  persist(
    (set) => ({
      operationSceneId: null,
      patientId: null,
      patientLabel: null,
      setScene: (operationSceneId) => set({ operationSceneId, patientId: null, patientLabel: null }),
      setPatient: (patientId, patientLabel = null) => set({ patientId, patientLabel }),
      clear: () => set({ operationSceneId: null, patientId: null, patientLabel: null }),
    }),
    {
      name: STORAGE_KEYS.workContext,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

// A login or logout in another tab replaces the context; never write the previous one back.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.workContext) void useWorkContextStore.persist.rehydrate();
  });
}
