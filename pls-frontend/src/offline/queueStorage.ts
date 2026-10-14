// Storage behind the offline queue (parity plan WP 6.3): the Ambulanzsystem client's layout ('queue'
// keyed by id, 'patient-map' keyed by the provisional patient id) under its own database name. The
// Ambulanzsystem queue has no owner filter, so the two must never share a database, not even on one
// origin (security review 4, L2).

export interface PatientMapping<P = unknown> {
  provisionalId: number;
  realId: number;
  patient: P;
}

export interface QueueStorage<T extends { id: string; writeId: string }> {
  all(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  put(item: T): Promise<void>;
  delete(id: string): Promise<void>;
  /**
   * Atomically: if the item under `id` is still the write `writeId`, replaces it with
   * `replacement` (or deletes it for null) and resolves true; otherwise leaves it alone. A newer
   * write stored meanwhile is never overwritten or removed (final review M2).
   */
  swapIfWrite(id: string, writeId: string, replacement: T | null): Promise<boolean>;
  /** Atomically records the mapping and removes the manual-patient item that produced it. */
  commitMapping(queueId: string, mapping: PatientMapping): Promise<void>;
  mapping(provisionalId: number): Promise<PatientMapping | undefined>;
  mappings(): Promise<PatientMapping[]>;
}

const DB_NAME = 'pls-offline';
const QUEUE = 'queue';
const MAP = 'patient-map';

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(QUEUE, { keyPath: 'id' });
      opening.result.createObjectStore(MAP);
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function withStores<R>(names: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => Promise<R>): Promise<R> {
  const db = await open();
  try {
    const transaction = db.transaction(names, mode);
    // The work's result counts only once the transaction committed (an abort rejects).
    const [result] = await Promise.all([work(transaction), done(transaction)]);
    return result;
  } finally {
    db.close();
  }
}

export function indexedDbStorage<T extends { id: string; writeId: string }>(): QueueStorage<T> {
  return {
    all: () => withStores([QUEUE], 'readonly', (t) => request<T[]>(t.objectStore(QUEUE).getAll())),
    get: (id) => withStores([QUEUE], 'readonly', (t) => request<T | undefined>(t.objectStore(QUEUE).get(id))),
    put: (item) => withStores([QUEUE], 'readwrite', async (t) => void (await request(t.objectStore(QUEUE).put(item)))),
    delete: (id) => withStores([QUEUE], 'readwrite', async (t) => void (await request(t.objectStore(QUEUE).delete(id)))),
    // Read and write in one readwrite transaction; the write is issued from the read's callback,
    // while the transaction is still active.
    swapIfWrite: (id, writeId, replacement) =>
      withStores([QUEUE], 'readwrite', (t) => new Promise<boolean>((resolve, reject) => {
        const store = t.objectStore(QUEUE);
        const reading = store.get(id);
        reading.onerror = () => reject(reading.error);
        reading.onsuccess = () => {
          const current = reading.result as T | undefined;
          if (!current || current.writeId !== writeId) {
            resolve(false);
            return;
          }
          const writing = replacement ? store.put(replacement) : store.delete(id);
          writing.onerror = () => reject(writing.error);
          writing.onsuccess = () => resolve(true);
        };
      })),
    commitMapping: (queueId, mapping) =>
      withStores([QUEUE, MAP], 'readwrite', async (t) => {
        t.objectStore(MAP).put(mapping, mapping.provisionalId);
        t.objectStore(QUEUE).delete(queueId);
      }),
    mapping: (provisionalId) =>
      withStores([MAP], 'readonly', async (t) => {
        const value = await request<PatientMapping | number | undefined>(t.objectStore(MAP).get(provisionalId));
        // Older Ambulanzsystem builds stored the bare real id.
        return typeof value === 'number' ? { provisionalId, realId: value, patient: null } : value;
      }),
    mappings: () =>
      withStores([MAP], 'readonly', async (t) => {
        const [keys, values] = await Promise.all([
          request<IDBValidKey[]>(t.objectStore(MAP).getAllKeys()),
          request<Array<PatientMapping | number>>(t.objectStore(MAP).getAll()),
        ]);
        return values.map((value, index) =>
          typeof value === 'number' ? { provisionalId: Number(keys[index]), realId: value, patient: null } : value,
        );
      }),
  };
}

/** In-memory storage with the same contract, for unit tests (no IndexedDB in jsdom). */
export function memoryStorage<T extends { id: string; writeId: string }>(): QueueStorage<T> & { failNextPut?: boolean } {
  const queue = new Map<string, T>();
  const map = new Map<number, PatientMapping>();
  const clone = <V>(value: V): V => structuredClone(value);
  const storage: QueueStorage<T> & { failNextPut?: boolean } = {
    all: async () => [...queue.values()].map(clone),
    get: async (id) => (queue.has(id) ? clone(queue.get(id)!) : undefined),
    put: async (item) => {
      if (storage.failNextPut) {
        storage.failNextPut = false;
        throw new Error('storage failed');
      }
      queue.set(item.id, clone(item));
    },
    delete: async (id) => void queue.delete(id),
    swapIfWrite: async (id, writeId, replacement) => {
      if (queue.get(id)?.writeId !== writeId) return false;
      if (replacement) queue.set(id, clone(replacement));
      else queue.delete(id);
      return true;
    },
    commitMapping: async (queueId, mapping) => {
      map.set(mapping.provisionalId, clone(mapping));
      queue.delete(queueId);
    },
    mapping: async (provisionalId) => (map.has(provisionalId) ? clone(map.get(provisionalId)!) : undefined),
    mappings: async () => [...map.values()].map(clone),
  };
  return storage;
}
