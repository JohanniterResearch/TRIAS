import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ApiClient } from '../api/api-client';
import type { components, paths } from '../api/openapi-types';
import { ProtokollDraftStore } from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { SyncStatusService } from './sync-status.service';

type Patient = components['schemas']['Patient'];
type ManualPatientRequest = paths['/api/persons/manual']['post']['requestBody']['content']['application/json'];
type TriageUpdateRequest = paths['/api/persons/{id}/update-triage-color']['post']['requestBody']['content']['application/json'];
type SaveProtokollRequest = paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['requestBody']['content']['application/json'];

type QueueItem =
  | { id: string; type: 'manual-patient'; body: ManualPatientRequest; provisionalId: number; createdAt: string }
  | { id: string; type: 'triage'; patientId: number; body: TriageUpdateRequest; createdAt: string }
  | { id: string; type: 'protocol'; patientId: number; body: SaveProtokollRequest; createdAt: string };
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
  private flushing = false;

  constructor() {
    window.addEventListener('online', () => this.flush().catch(() => undefined));
    this.refreshStatus();
    this.reconcileMappings()
      .then(() => navigator.onLine ? this.flush() : undefined)
      .catch(() => undefined);
  }

  async createProvisionalPatient(body: ManualPatientRequest): Promise<Patient> {
    const provisionalId = -Date.now();
    const now = new Date().toISOString();
    const clientGeneratedId = body.clientGeneratedId ?? crypto.randomUUID();
    await this.add({ id: crypto.randomUUID(), type: 'manual-patient', body: { ...body, clientGeneratedId }, provisionalId, createdAt: now });
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
    await this.add({ id: `triage:${patientId}`, type: 'triage', patientId, body, createdAt: new Date().toISOString() });
  }

  async queueProtocol(patientId: number, body: SaveProtokollRequest): Promise<void> {
    await this.add({ id: `protocol:${patientId}`, type: 'protocol', patientId, body, createdAt: new Date().toISOString() });
  }

  async flush(): Promise<void> {
    if (!navigator.onLine || this.flushing) {
      return;
    }

    this.flushing = true;
    try {
      for (const item of await this.items()) {
        if (item.type === 'manual-patient') {
          const patient = await firstValueFrom(this.api.createManualPatient(item.body));
          await this.commitPatientMapping(item.id, item.provisionalId, patient);
          await this.reconcilePatient({ provisionalId: item.provisionalId, realId: patient.id, patient });
          continue;
        }
        const done = await this.replay(item);
        if (!done) {
          break;
        }
        await this.delete(item.id);
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

  private async delete(id: string): Promise<void> {
    await this.withStore(queueStore, 'readwrite', (store) => request(store.delete(id)));
  }

  private async items(): Promise<QueueItem[]> {
    return (await this.withStore(queueStore, 'readonly', (store) => request<QueueItem[]>(store.getAll()))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async commitPatientMapping(queueId: string, provisionalId: number, patient: Patient): Promise<void> {
    const db = await openDb();
    try {
      const transaction = db.transaction([queueStore, mapStore], 'readwrite');
      transaction.objectStore(mapStore).put(
        { provisionalId, realId: patient.id, patient } satisfies PatientMapping,
        provisionalId,
      );
      transaction.objectStore(queueStore).delete(queueId);
      await transactionDone(transaction);
    } finally {
      db.close();
    }
  }

  private async reconcileMappings(): Promise<void> {
    const mappings = await this.withStore(
      mapStore,
      'readonly',
      (store) => request<Array<PatientMapping | number>>(store.getAll()),
    );
    for (const mapping of mappings) {
      if (typeof mapping !== 'number') {
        await this.reconcilePatient(mapping);
      }
    }
  }

  private async reconcilePatient(mapping: PatientMapping): Promise<void> {
    this.responderState.replacePatient(mapping.provisionalId, mapping.patient);
    this.triageDrafts.rekey(mapping.provisionalId, mapping.realId);
    await this.protocolDrafts.rekey(mapping.provisionalId, mapping.realId);
  }

  private async realPatientId(patientId: number): Promise<number> {
    if (patientId >= 0) {
      return patientId;
    }
    return await this.withStore(
      mapStore,
      'readonly',
      (store) => request<PatientMapping | number | undefined>(store.get(patientId)),
    ).then((mapping) => typeof mapping === 'number' ? mapping : mapping?.realId ?? patientId);
  }

  private async refreshStatus(): Promise<void> {
    const items = await this.items().catch(() => []);
    this.syncStatus.setPending(items.length, items[0]?.createdAt ?? null);
  }

  private async withStore<T>(name: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await openDb();
    try {
      return await work(db.transaction(name, mode).objectStore(name));
    } finally {
      db.close();
    }
  }
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
