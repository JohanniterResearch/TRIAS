import { Injectable, inject } from '@angular/core';

import { environment } from '../../environments/environment';
import { AuthStore } from '../auth/auth.store';
import type { components, paths } from '../api/openapi-types';
import { SyncStatusService } from './sync-status.service';

type Patient = components['schemas']['Patient'];
type ManualPatientRequest = paths['/api/persons/manual']['post']['requestBody']['content']['application/json'];
type TriageUpdateRequest = paths['/api/persons/{id}/update-triage-color']['post']['requestBody']['content']['application/json'];
type SaveProtokollRequest = paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['requestBody']['content']['application/json'];

type QueueItem =
  | { id: string; type: 'manual-patient'; body: ManualPatientRequest; provisionalId: number; createdAt: string }
  | { id: string; type: 'triage'; patientId: number; body: TriageUpdateRequest; createdAt: string }
  | { id: string; type: 'protocol'; patientId: number; body: SaveProtokollRequest; createdAt: string };

const dbName = 'ambulanzsystem-offline';
const queueStore = 'queue';
const mapStore = 'patient-map';

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly auth = inject(AuthStore);
  private readonly syncStatus = inject(SyncStatusService);
  private flushing = false;

  constructor() {
    window.addEventListener('online', () => this.flush().catch(() => undefined));
    this.refreshStatus();
    if (navigator.onLine) {
      this.flush().catch(() => undefined);
    }
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

  private async replay(item: QueueItem): Promise<boolean> {
    if (item.type === 'manual-patient') {
      const patient = await this.request<Patient>('/api/persons/manual', 'POST', item.body);
      await this.mapPatient(item.provisionalId, patient.id);
      return true;
    }

    const patientId = await this.realPatientId(item.patientId);
    if (patientId < 0) {
      return false;
    }

    if (item.type === 'triage') {
      await this.request(`/api/persons/${patientId}/update-triage-color`, 'POST', item.body);
    } else {
      await this.request(`/api/persons/${patientId}/ambulanzprotokoll-page1`, 'PUT', item.body);
    }
    return true;
  }

  private async request<T>(path: string, method: string, body: unknown): Promise<T> {
    const response = await fetch(`${environment.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.auth.bearerToken() ? { Authorization: `Bearer ${this.auth.bearerToken()}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`sync failed ${response.status}`);
    }
    this.syncStatus.markSynced();
    return await response.json();
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

  private async mapPatient(provisionalId: number, realId: number): Promise<void> {
    await this.withStore(mapStore, 'readwrite', (store) => request(store.put(realId, provisionalId)));
  }

  private async realPatientId(patientId: number): Promise<number> {
    if (patientId >= 0) {
      return patientId;
    }
    return await this.withStore(mapStore, 'readonly', (store) => request<number | undefined>(store.get(patientId))).then((id) => id ?? patientId);
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
