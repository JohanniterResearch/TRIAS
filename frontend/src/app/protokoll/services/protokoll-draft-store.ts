import { Injectable } from '@angular/core';

export interface ProtokollDraftRecord {
  patientId: number;
  sceneId?: number;
  status: 'draft' | 'finalized';
  updatedAt: string;
  finalizedAt?: string | null;
  formState: unknown;
  warnings?: string[];
}

const dbName = 'ambulanzsystem-protokoll';
const storeName = 'page1-drafts';

@Injectable({ providedIn: 'root' })
export class ProtokollDraftStore {
  async get(patientId: number): Promise<ProtokollDraftRecord | null> {
    return this.withStore('readonly', (store) =>
      request<ProtokollDraftRecord | undefined>(store.get(patientId)),
    ).then((record) => record ?? null);
  }

  async put(record: ProtokollDraftRecord): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.put(record)));
  }

  async rekey(provisionalId: number, realId: number): Promise<void> {
    await this.withStore('readwrite', async (store) => {
      const provisional = await request<ProtokollDraftRecord | undefined>(store.get(provisionalId));
      if (!provisional) {
        return;
      }
      const real = await request<ProtokollDraftRecord | undefined>(store.get(realId));
      const newer =
        !real || Date.parse(provisional.updatedAt) >= Date.parse(real.updatedAt)
          ? provisional
          : real;
      await request(store.put({ ...newer, patientId: realId }));
      await request(store.delete(provisionalId));
    });
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.clear()));
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    try {
      const transaction = db.transaction(storeName, mode);
      const completed = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const [result] = await Promise.all([work(transaction.objectStore(storeName)), completed]);
      return result;
    } finally {
      db.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(dbName, 1);
      openRequest.onupgradeneeded = () =>
        openRequest.result.createObjectStore(storeName, { keyPath: 'patientId' });
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
