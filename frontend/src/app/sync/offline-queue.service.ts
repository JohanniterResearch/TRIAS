import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiClient, ApiRequestError } from '../api/api-client';
import type { components, paths } from '../api/openapi-types';
import { ProtokollDraftStore } from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { SyncStatusService } from './sync-status.service';

type Patient = components['schemas']['Patient'];
type ManualPatientRequest =
  paths['/api/persons/manual']['post']['requestBody']['content']['application/json'];
type TriageUpdateRequest =
  paths['/api/persons/{id}/update-triage-color']['post']['requestBody']['content']['application/json'];
type SaveProtokollRequest =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['requestBody']['content']['application/json'];

type QueueMetadata = {
  writeId?: string;
  state?: 'pending' | 'retrying' | 'blocked';
  attemptCount?: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  errorStatus?: number | null;
  nextAttemptAt?: string | null;
};
type QueueItem = QueueMetadata &
  (
    | {
        id: string;
        type: 'manual-patient';
        body: ManualPatientRequest;
        provisionalId: number;
        createdAt: string;
      }
    | {
        id: string;
        type: 'triage';
        patientId: number;
        body: TriageUpdateRequest;
        createdAt: string;
      }
    | {
        id: string;
        type: 'protocol';
        patientId: number;
        body: SaveProtokollRequest;
        createdAt: string;
      }
  );
type PendingWrite = Exclude<QueueItem, { type: 'manual-patient' }>;
type PatientMapping = { provisionalId: number; realId: number; patient: Patient };

const dbName = 'ambulanzsystem-offline';
const queueStore = 'queue';
const mapStore = 'patient-map';

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly api = inject(ApiClient);
  private readonly responderState = inject(ResponderStateStore);
  private readonly triageDrafts = inject(TriageDraftStore);
  private readonly protocolDrafts = inject(ProtokollDraftStore);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly ready: Promise<void>;
  private flushing = false;

  constructor() {
    window.addEventListener('online', () => this.flush().catch(() => undefined));
    window.setInterval(() => navigator.onLine && this.flush().catch(() => undefined), 30_000);
    this.refreshStatus();
    this.ready = this.reconcileMappings();
    this.ready.then(() => (navigator.onLine ? this.flush() : undefined)).catch(() => undefined);
  }

  whenReady(): Promise<void> {
    return this.ready.catch(() => undefined);
  }

  async createProvisionalPatient(body: ManualPatientRequest): Promise<Patient> {
    const provisionalId = -Date.now();
    const now = new Date().toISOString();
    const clientGeneratedId = body.clientGeneratedId ?? crypto.randomUUID();
    await this.add(
      withMetadata({
        id: crypto.randomUUID(),
        type: 'manual-patient',
        body: { ...body, clientGeneratedId },
        provisionalId,
        createdAt: now,
      }),
    );
    return {
      id: provisionalId,
      humanReadableId: `Lokal-${Math.abs(provisionalId).toString().slice(-6)}`,
      clientGeneratedId,
      name: body.name ?? null,
      operationSceneId: body.operationSceneId,
      createdAt: now,
      updatedAt: now,
    };
  }

  async queueTriage(patientId: number, body: TriageUpdateRequest): Promise<void> {
    await this.add(
      withMetadata({
        id: `triage:${patientId}:${crypto.randomUUID()}`,
        type: 'triage',
        patientId,
        body,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async queueProtocol(patientId: number, body: SaveProtokollRequest): Promise<void> {
    await this.add(
      withMetadata({
        id: `protocol:${patientId}`,
        type: 'protocol',
        patientId,
        body,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async flush(): Promise<void> {
    if (!navigator.onLine || this.flushing) {
      return;
    }

    this.flushing = true;
    try {
      for (const item of await this.items()) {
        if (item.state === 'blocked' && item.errorStatus !== 401 && item.errorStatus !== 403) {
          continue;
        }
        if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) {
          continue;
        }
        try {
          if (item.type === 'manual-patient') {
            const patient = await firstValueFrom(this.api.createManualPatient(item.body));
            await this.commitPatientMapping(item.id, item.provisionalId, patient);
            await this.reconcilePatient({
              provisionalId: item.provisionalId,
              realId: patient.id,
              patient,
            });
            continue;
          }
          const done = await this.replay(item);
          if (!done) {
            await this.defer(item, 'Patientenzuordnung ausstehend');
            continue;
          }
          await this.deleteIfCurrent(item);
        } catch (error) {
          const authBlocked = await this.recordFailure(item, error);
          if (authBlocked) {
            break;
          }
        }
      }
    } finally {
      this.flushing = false;
      await this.refreshStatus();
    }
  }

  async clear(): Promise<void> {
    await this.withStore(queueStore, 'readwrite', (store) => request(store.clear()));
    await this.withStore(mapStore, 'readwrite', (store) => request(store.clear()));
    await this.refreshStatus();
  }

  private async replay(item: PendingWrite): Promise<boolean> {
    const patientId = await this.realPatientId(item.patientId);
    if (patientId < 0) {
      return false;
    }

    if (item.type === 'triage') {
      await firstValueFrom(this.api.updateTriage(patientId, item.body));
    } else {
      await firstValueFrom(this.api.saveProtokollPage1(patientId, item.body));
    }
    return true;
  }

  private async add(item: QueueItem): Promise<void> {
    await this.withStore(queueStore, 'readwrite', (store) => request(store.put(item)));
    await this.refreshStatus();
  }

  private async deleteIfCurrent(item: QueueItem): Promise<void> {
    const deleted = await this.withStore(queueStore, 'readwrite', async (store) => {
      const current = await request<QueueItem | undefined>(store.get(item.id));
      if (!sameQueueWrite(current, item)) return false;
      await request(store.delete(item.id));
      return true;
    });
    if (deleted) this.syncStatus.markQueueFlushed();
  }

  private async replaceIfCurrent(original: QueueItem, replacement: QueueItem): Promise<boolean> {
    return this.withStore(queueStore, 'readwrite', async (store) => {
      const current = await request<QueueItem | undefined>(store.get(original.id));
      if (!sameQueueWrite(current, original)) return false;
      await request(store.put(replacement));
      return true;
    });
  }

  private async defer(item: QueueItem, message: string): Promise<void> {
    await this.replaceIfCurrent(item, {
      ...item,
      state: 'retrying',
      lastError: message,
      nextAttemptAt: null,
    });
  }

  private async recordFailure(item: QueueItem, error: unknown): Promise<boolean> {
    const status = error instanceof ApiRequestError ? error.status : null;
    const authBlocked = status === 401 || status === 403;
    const permanentlyBlocked = status !== null && status >= 400 && status < 500;
    const attemptCount = (item.attemptCount ?? 0) + 1;
    const retryDelay = Math.min(60_000, 1000 * 2 ** Math.min(attemptCount - 1, 6));
    await this.replaceIfCurrent(item, {
      ...item,
      state: permanentlyBlocked ? 'blocked' : 'retrying',
      attemptCount,
      lastAttemptAt: new Date().toISOString(),
      lastError: status === null ? 'Netzwerkfehler' : `HTTP ${status}`,
      errorStatus: status,
      nextAttemptAt: permanentlyBlocked ? null : new Date(Date.now() + retryDelay).toISOString(),
    });
    return authBlocked;
  }

  private async items(): Promise<QueueItem[]> {
    return (
      await this.withStore(queueStore, 'readonly', (store) => request<QueueItem[]>(store.getAll()))
    ).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async commitPatientMapping(
    queueId: string,
    provisionalId: number,
    patient: Patient,
  ): Promise<void> {
    const db = await openDb();
    try {
      const transaction = db.transaction([queueStore, mapStore], 'readwrite');
      transaction
        .objectStore(mapStore)
        .put(
          { provisionalId, realId: patient.id, patient } satisfies PatientMapping,
          provisionalId,
        );
      transaction.objectStore(queueStore).delete(queueId);
      await transactionDone(transaction);
      this.syncStatus.markQueueFlushed();
    } finally {
      db.close();
    }
  }

  private async reconcileMappings(): Promise<void> {
    const [keys, mappings] = await this.withStore(mapStore, 'readonly', (store) =>
      Promise.all([
        request<IDBValidKey[]>(store.getAllKeys()),
        request<Array<PatientMapping | number>>(store.getAll()),
      ]),
    );
    for (const [index, mapping] of mappings.entries()) {
      if (typeof mapping === 'number') {
        const provisionalId = Number(keys[index]);
        const currentPatient = this.responderState.patient();
        const patient =
          currentPatient?.id === provisionalId ? { ...currentPatient, id: mapping } : undefined;
        await this.reconcilePatientIds(provisionalId, mapping, patient);
        if (patient) {
          await this.withStore(mapStore, 'readwrite', (store) =>
            request(
              store.put(
                { provisionalId, realId: mapping, patient } satisfies PatientMapping,
                provisionalId,
              ),
            ),
          );
        }
      } else {
        await this.reconcilePatient(mapping);
      }
    }
  }

  private async reconcilePatient(mapping: PatientMapping): Promise<void> {
    await this.reconcilePatientIds(mapping.provisionalId, mapping.realId, mapping.patient);
  }

  private async reconcilePatientIds(
    provisionalId: number,
    realId: number,
    patient?: Patient,
  ): Promise<void> {
    await this.protocolDrafts.rekey(provisionalId, realId);
    if (patient) {
      this.responderState.replacePatient(provisionalId, patient);
    }
    this.triageDrafts.rekey(provisionalId, realId);
  }

  private async realPatientId(patientId: number): Promise<number> {
    if (patientId >= 0) {
      return patientId;
    }
    return await this.withStore(mapStore, 'readonly', (store) =>
      request<PatientMapping | number | undefined>(store.get(patientId)),
    ).then((mapping) => (typeof mapping === 'number' ? mapping : (mapping?.realId ?? patientId)));
  }

  private async refreshStatus(): Promise<void> {
    const items = await this.items().catch(() => []);
    const failed = items.filter((item) => item.lastError);
    this.syncStatus.setPending(
      items.length,
      items[0]?.createdAt ?? null,
      failed.length,
      failed[0]?.lastError ?? null,
    );
  }

  private async withStore<T>(
    name: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await openDb();
    try {
      return await work(db.transaction(name, mode).objectStore(name));
    } finally {
      db.close();
    }
  }
}

function withMetadata<T extends QueueItem>(item: T): T {
  return {
    ...item,
    writeId: crypto.randomUUID(),
    state: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    errorStatus: null,
    nextAttemptAt: null,
  };
}

export function sameQueueWrite(current: QueueItem | undefined, expected: QueueItem): boolean {
  if (!current) return false;
  if (current.writeId && expected.writeId) return current.writeId === expected.writeId;
  return (
    current.createdAt === expected.createdAt &&
    JSON.stringify(current.body) === JSON.stringify(expected.body)
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(dbName, 1);
    openRequest.onupgradeneeded = () => {
      openRequest.result.createObjectStore(queueStore, { keyPath: 'id' });
      openRequest.result.createObjectStore(mapStore);
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
