import { Injectable } from '@angular/core';

import { request, transactionDone } from '../../shared/idb';

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

  async deleteExcept(keep: Set<number>): Promise<void> {
    await this.withStore('readwrite', async (store) => {
      const keys = await request<IDBValidKey[]>(store.getAllKeys());
      for (const key of keys) if (!keep.has(Number(key))) await request(store.delete(key));
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
      const [result] = await Promise.all([
        work(transaction.objectStore(storeName)),
        transactionDone(transaction),
      ]);
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
