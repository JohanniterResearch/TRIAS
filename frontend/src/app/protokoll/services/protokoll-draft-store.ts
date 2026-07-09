import { Injectable } from '@angular/core';

export interface ProtokollDraftRecord {
  patientId: number;
  sceneId?: number;
  status: 'draft' | 'finalized';
  updatedAt: string;
  finalizedAt?: string | null;
  formState: unknown;
}

const dbName = 'ambulanzsystem-protokoll';
const storeName = 'page1-drafts';

@Injectable({ providedIn: 'root' })
export class ProtokollDraftStore {
  async get(patientId: number): Promise<ProtokollDraftRecord | null> {
    return this.withStore('readonly', (store) => request<ProtokollDraftRecord | undefined>(store.get(patientId))).then((record) => record ?? null);
  }

  async put(record: ProtokollDraftRecord): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.put(record)));
  }

  private async withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    try {
      return await work(db.transaction(storeName, mode).objectStore(storeName));
    } finally {
      db.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(dbName, 1);
      openRequest.onupgradeneeded = () => openRequest.result.createObjectStore(storeName, { keyPath: 'patientId' });
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
  }
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}
