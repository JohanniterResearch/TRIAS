import { Injectable } from '@angular/core';
import { request, transactionDone } from '../shared/idb';

export type PatientWriteKind =
  | 'qr-intake'
  | 'qr-reassign'
  | 'admin-patient'
  | 'admin-body'
  | 'admin-qr'
  | 'team'
  | 'protocol-export'
  | 'respiration';
export interface PatientWriteIntent {
  writeId: string;
  kind: PatientWriteKind;
  target: string | number | null;
  body: unknown;
  owner: string;
  blocked?: boolean;
}
export function patientWriteContents(body: unknown): string {
  return JSON.stringify(body, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}

// Durable BEFORE the first HTTP request. Separate from clinical draft coalescing: every action
// has its own UUID, even for identical contents. No new offline editing UI is introduced.
@Injectable({ providedIn: 'root' })
export class PatientWriteJournal {
  async put(intent: PatientWriteIntent): Promise<void> {
    await this.withStore('readwrite', async (store) => {
      const current = await request<PatientWriteIntent | undefined>(
        store.get(this.identity(intent)),
      );
      if (current && patientWriteContents(current.body) !== patientWriteContents(intent.body))
        throw new Error('Die Vorgangskennung gehört bereits zu einem anderen Auftragsinhalt.');
      await request(store.put({ ...structuredClone(intent), id: this.identity(intent) }));
    });
  }
  async remove(intent: PatientWriteIntent): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.delete(this.identity(intent))));
  }
  private identity(intent: PatientWriteIntent): string {
    return JSON.stringify([intent.kind, intent.target, intent.writeId]);
  }
  async pending(owner: string): Promise<PatientWriteIntent[]> {
    const all = await this.withStore('readonly', (store) =>
      request<PatientWriteIntent[]>(store.getAll()),
    );
    return all.filter((item) => item.owner === owner && !item.blocked);
  }
  private async withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('ambulanzsystem-patient-writes', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('orders', { keyPath: 'id' });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    try {
      const tx = db.transaction('orders', mode);
      const [result] = await Promise.all([work(tx.objectStore('orders')), transactionDone(tx)]);
      return result;
    } finally {
      db.close();
    }
  }
}
