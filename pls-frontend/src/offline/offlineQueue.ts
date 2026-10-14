import { useSyncExternalStore } from 'react';
import client, { apiErrorMessage, httpStatus, isUnavailable, OwnerMismatchError } from '../api/client';
import type { Body, Patient, Res } from '../api/endpoints';
import { isEmptyLeaf, leafAt, leafPaths } from '../features/ambulanzprotokoll-page1/formStateDiff';
import { currentDraftOwner, rekeyPage1Draft } from '../features/ambulanzprotokoll-page1/page1Storage';
import { useWorkContextStore } from '../stores/workContextStore';
import { createOfflineQueue, type ProtocolSaved, type QueueItem, type QueueStatus, type QueueTransport } from './queue';
import { indexedDbStorage, memoryStorage } from './queueStorage';

// The app's one offline queue (parity plan Phase 6): IndexedDB storage, the HTTP transport, and
// what happens when a provisional patient gets its server id. Pages use `sendOrQueue`.

type ProtocolBody = Body<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>;
type ProtocolRecord = Res<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'get'>;

const protocolPath = (patientId: number) => `/api/persons/${patientId}/ambulanzprotokoll-page1`;

/** True when the server already holds every non-empty value of `sent` (its formState). */
function holdsAll(server: unknown, sent: unknown): boolean {
  return leafPaths(sent as Record<string, unknown>).every((path) => {
    const value = leafAt(sent, path);
    return isEmptyLeaf(value) || JSON.stringify(leafAt(server, path)) === JSON.stringify(value);
  });
}

const transport: QueueTransport = {
  createManualPatient: async (owner, body) => (await client.post<Patient>('/api/persons/manual', body, { expectedOwner: owner })).data,
  triage: async (owner, patientId, body) =>
    (await client.post<Patient>(`/api/persons/${patientId}/update-triage-color`, body, { expectedOwner: owner })).data,
  location: async (owner, patientId, body) =>
    (await client.post<Patient>(`/api/persons/${patientId}/location`, body, { expectedOwner: owner })).data,
  bodyPart: async (owner, body) => (await client.put('/api/body-parts', body, { expectedOwner: owner })).data,
  protocol: async (owner, patientId, body) => {
    try {
      return (await client.put<ProtocolRecord>(protocolPath(patientId), body, { expectedOwner: owner })).data;
    } catch (error) {
      // A finalization whose answer was lost is refused on replay (400: a finalized protocol needs
      // a correction reason). If the server holds what was sent, that earlier send landed.
      // A QR or non-owner session gets 403 there instead (only staff and the owner may correct).
      if ([400, 403].includes(httpStatus(error) ?? 0) && body.status === 'finalized' && !body.correctionReason) {
        const { data } = await client.get<ProtocolRecord>(protocolPath(patientId), { expectedOwner: owner });
        if (data.status === 'finalized' && holdsAll(data.formState, body.formState)) return data;
      }
      throw error;
    }
  },
};

/** False when this browser offers no IndexedDB: queued work then lasts only until a reload. */
export const queuePersistent = typeof indexedDB !== 'undefined';

const mappedListeners = new Set<(provisionalId: number, patient: Patient) => void>();
const protocolListeners = new Set<(saved: ProtocolSaved) => void>();

const storage = queuePersistent ? indexedDbStorage<QueueItem>() : memoryStorage<QueueItem>();

export const offlineQueue = createOfflineQueue({
  storage,
  transport,
  currentOwner: currentDraftOwner,
  isTransportFailure: isUnavailable,
  httpStatus,
  exclusive: (task) =>
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('pls-offline-flush', { ifAvailable: true }, (lock) => (lock ? task() : undefined)).then(() => undefined)
      : task(),
  errorMessage: apiErrorMessage,
  onPatientMapped: (provisionalId, patient, owner) => {
    // WP 6.4: everything that still names the provisional id moves to the server id; the draft
    // of the session that created the patient, even if another one is signed in now (L2).
    rekeyPage1Draft(provisionalId, patient.id, owner);
    const context = useWorkContextStore.getState();
    if (context.patientId === provisionalId) context.setPatient(patient.id, patient.humanReadableId ?? null);
    for (const listener of mappedListeners) listener(provisionalId, patient);
  },
  onProtocolSaved: (saved) => {
    for (const listener of protocolListeners) listener(saved);
  },
});

export function onPatientMapped(listener: (provisionalId: number, patient: Patient) => void) {
  mappedListeners.add(listener);
  return () => void mappedListeners.delete(listener);
}

export function onProtocolSaved(listener: (saved: ProtocolSaved) => void) {
  protocolListeners.add(listener);
  return () => void protocolListeners.delete(listener);
}

/**
 * The write rule of the Ambulanzsystem client: a provisional patient, or one that already has
 * queued writes, is queued (order is kept); otherwise the write is sent and only an unreachable
 * server (no answer, timeout, gateway error) queues it. Server refusals are thrown to the caller.
 *
 * The write belongs to the session that made the change (`owner`, default: the one signed in
 * now): `send` and `enqueue` receive it and must bind to it (`expectedOwner`), so a change is
 * never sent or queued under an account that signed in while it was in flight (D11).
 */
export async function sendOrQueue<T>(
  patientId: number,
  send: (owner: string) => Promise<T>,
  enqueue: (owner: string) => Promise<unknown>,
  owner: string | null = currentDraftOwner(),
): Promise<{ queued: true } | { queued: false; result: T }> {
  if (!owner || currentDraftOwner() !== owner) throw new OwnerMismatchError();
  if (await offlineQueue.hasPendingFor(patientId)) {
    await enqueue(owner);
    void offlineQueue.flush();
    return { queued: true };
  }
  try {
    return { queued: false, result: await send(owner) };
  } catch (error) {
    if (!isUnavailable(error)) throw error;
    await enqueue(owner);
    return { queued: true };
  }
}

export const isProvisional = (patientId: number | null | undefined) => typeof patientId === 'number' && patientId < 0;

export function useQueueStatus(): QueueStatus {
  return useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getStatus);
}

export type { ProtocolBody };

let started = false;
const FLUSH_INTERVAL_MS = 30_000;

/** Send at start and when the browser is back online (backoff skipped), and every 30 s. */
export function startOfflineQueue(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => void offlineQueue.flush(true));
  window.setInterval(() => void offlineQueue.flush(), FLUSH_INTERVAL_MS);
  void offlineQueue.refresh().then(() => offlineQueue.flush(true));
}

/** Tests only (jsdom has no IndexedDB): the queue is a module singleton, empty it between tests. */
export async function clearOfflineQueueForTests(): Promise<void> {
  for (const item of await storage.all()) await storage.delete(item.id);
  await offlineQueue.refresh();
}
