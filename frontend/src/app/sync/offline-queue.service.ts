import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

import { apiErrorMessage, ApiClient, ApiRequestError, type JsonBody } from '../api/api-client';
import type { components, paths } from '../api/openapi-types';
import {
  ProtokollDraftRecord,
  ProtokollDraftStore,
} from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { request, transactionDone } from '../shared/idb';
import { SyncStatusService } from './sync-status.service';

type Patient = components['schemas']['Patient'];
type ManualPatientRequest = JsonBody<'/api/persons/manual', 'post'>;
type TriageUpdateRequest = JsonBody<'/api/persons/{id}/update-triage-color', 'post'>;
type LocationRequest = JsonBody<'/api/persons/{id}/location', 'post'>;
type BodyPartRequest = JsonBody<'/api/body-parts', 'put'>;
type SaveProtokollRequest = JsonBody<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>;

type ProtocolResponse =
  paths['/api/persons/{patientId}/ambulanzprotokoll-page1']['put']['responses'][200]['content']['application/json'];
export interface ProtocolSaveResult {
  patientId: number;
  sourcePatientId: number;
  writeId: string;
  record: ProtocolResponse;
}

type QueueMetadata = {
  writeId?: string;
  state?: 'pending' | 'retrying' | 'blocked';
  attemptCount?: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  errorStatus?: number | null;
  nextAttemptAt?: string | null;
};
type QueueItem = QueueMetadata & { id: string; createdAt: string } & (
    | { type: 'manual-patient'; body: ManualPatientRequest; provisionalId: number }
    | { type: 'triage'; patientId: number; body: TriageUpdateRequest }
    | { type: 'location'; patientId: number; body: LocationRequest }
    | { type: 'body-part'; patientId: number; body: BodyPartRequest }
    | {
        type: 'protocol';
        patientId: number;
        body: SaveProtokollRequest;
        sceneId?: number;
        finalizedAt?: string | null;
      }
  );
export interface BlockedItem {
  id: string;
  type: QueueItem['type'];
  patientId: number;
  errorStatus: number | null;
  lastError: string | null;
  createdAt: string;
}
type PendingWrite = Exclude<QueueItem, { type: 'manual-patient' }>;
type ProtocolWrite = Extract<QueueItem, { type: 'protocol' }>;
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
  private flushRequested = false;
  private immediateFlushRequested = false;
  private protocolTimer = 0;
  private readonly protocolNotBefore = new Map<number, number>();
  private persistence: Promise<void> = Promise.resolve();
  private readonly unsavedProtocols = new Map<number, ProtocolWrite>();
  readonly localWrites = signal(0);
  readonly blockedItems = signal<BlockedItem[]>([]);
  private readonly exportedIds = new Set<string>();
  readonly hasPendingWork = computed(
    () =>
      this.localWrites() > 0 || !this.syncStatus.queueReady() || this.syncStatus.pendingCount() > 0,
  );
  private readonly protocolSavedSubject = new Subject<ProtocolSaveResult>();
  readonly protocolSaved = this.protocolSavedSubject.asObservable();

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

  async pendingTriage(patientId: number): Promise<TriageUpdateRequest[]> {
    await this.whenReady();
    const realId = await this.realPatientId(patientId);
    const pending: Array<Extract<QueueItem, { type: 'triage' }>> = [];
    for (const item of await this.items()) {
      if (item.type === 'triage' && (await this.realPatientId(item.patientId)) === realId) {
        pending.push(item);
      }
    }
    return pending
      .sort((a, b) =>
        (a.body.clientUpdatedAt ?? a.createdAt).localeCompare(
          b.body.clientUpdatedAt ?? b.createdAt,
        ),
      )
      .map((item) => item.body);
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

  // One key per patient (location) or per region (body part): a newer intent replaces the older
  // unsent one, since both are absolute values rather than increments.
  async queueLocation(patientId: number, body: LocationRequest): Promise<void> {
    await this.add(
      withMetadata({
        id: `location:${patientId}`,
        type: 'location',
        patientId,
        body: { ...body, clientUpdatedAt: body.clientUpdatedAt ?? new Date().toISOString() },
        createdAt: new Date().toISOString(),
      }),
    );
  }

  async queueBodyPart(patientId: number, body: BodyPartRequest): Promise<void> {
    await this.add(
      withMetadata({
        id: `body-part:${patientId}:${body.bodyPartId}`,
        type: 'body-part',
        patientId,
        body,
        createdAt: new Date().toISOString(),
      }),
    );
  }

  queueProtocol(
    patientId: number,
    body: SaveProtokollRequest,
    local: Pick<ProtokollDraftRecord, 'sceneId' | 'finalizedAt'> = {},
  ): Promise<string> {
    const item: ProtocolWrite = withMetadata({
      id: `protocol:${patientId}`,
      type: 'protocol' as const,
      patientId,
      body: structuredClone(body),
      ...local,
      createdAt: new Date().toISOString(),
    });
    this.protocolNotBefore.set(patientId, Date.now() + 800);
    this.unsavedProtocols.set(patientId, item);
    this.localWrites.set(this.unsavedProtocols.size);
    return this.persistProtocol(item).then(() => item.writeId!);
  }

  async pendingProtocol(
    patientId: number,
  ): Promise<(ProtokollDraftRecord & { writeId?: string }) | null> {
    const unsaved = this.unsavedProtocols.get(patientId);
    if (unsaved) return { ...protocolDraft(unsaved), writeId: unsaved.writeId };
    const realId = await this.realPatientId(patientId);
    const items = [...(await this.items()), ...this.unsavedProtocols.values()];
    for (const item of items.reverse()) {
      if (item.type === 'protocol' && (await this.realPatientId(item.patientId)) === realId)
        return { ...protocolDraft(item), patientId, writeId: item.writeId };
    }
    return null;
  }

  private persistProtocol(item: ProtocolWrite): Promise<void> {
    const writing = this.persistence.then(async () => {
      if (this.unsavedProtocols.get(item.patientId) !== item) return;
      await this.add(item);
      if (this.unsavedProtocols.get(item.patientId) === item) {
        this.unsavedProtocols.delete(item.patientId);
        this.localWrites.set(this.unsavedProtocols.size);
      }
      // The committed queue remains authoritative if the optional draft cache fails.
      await this.protocolDrafts.put(protocolDraft(item)).catch(() => undefined);
      window.clearTimeout(this.protocolTimer);
      this.protocolTimer = window.setTimeout(() => this.flush().catch(() => undefined), 800);
    });
    this.persistence = writing.catch(() => undefined);
    return writing;
  }

  async flush(immediate = false): Promise<void> {
    if (this.flushing) {
      this.flushRequested = true;
      this.immediateFlushRequested ||= immediate;
      return;
    }

    this.flushing = true;
    try {
      for (const item of this.unsavedProtocols.values()) await this.persistProtocol(item);
      await this.persistence;
      if (!navigator.onLine) return;
      for (const item of await this.items()) {
        if (
          item.type === 'protocol' &&
          (this.unsavedProtocols.has(item.patientId) ||
            (!immediate && (this.protocolNotBefore.get(item.patientId) ?? 0) > Date.now()))
        )
          continue;
        // Only an expired/invalid session is retried automatically; other rejections wait for
        // an explicit retry, export, or discard so they cannot stall unrelated writes.
        if (item.state === 'blocked' && item.errorStatus !== 401) {
          continue;
        }
        if (item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) {
          continue;
        }
        try {
          if (item.type === 'manual-patient') {
            const patient = await firstValueFrom(this.api.createManualPatient(item.body));
            await this.commitPatientMapping(item.id, item.provisionalId, patient);
            await this.reconcilePatientIds(item.provisionalId, patient.id, patient);
            continue;
          }
          const result = await this.replay(item);
          if (!result) {
            await this.defer(item, 'Patientenzuordnung ausstehend');
            continue;
          }
          if (item.type === 'protocol' && typeof result !== 'boolean') {
            const current = await this.withStore(queueStore, 'readonly', (store) =>
              request<QueueItem | undefined>(store.get(item.id)),
            );
            if (this.unsavedProtocols.has(item.patientId) || !sameQueueWrite(current, item))
              continue;
            // Preserve acknowledgements in the cache before dropping the durable upload intent.
            await this.protocolDrafts.put({
              ...protocolDraft(item),
              patientId: result.patientId,
              status: result.record.status,
              formState: result.record.formState,
              updatedAt: result.record.updatedAt,
              finalizedAt: result.record.finalizedAt,
              warnings: result.record.warnings,
            });
          }
          const deleted = await this.deleteIfCurrent(item);
          if (deleted && item.type === 'protocol') this.protocolNotBefore.delete(item.patientId);
          if (
            deleted &&
            item.type === 'protocol' &&
            typeof result !== 'boolean' &&
            !this.unsavedProtocols.has(item.patientId)
          )
            this.protocolSavedSubject.next(result);
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
      if (this.flushRequested) {
        const immediate = this.immediateFlushRequested;
        this.flushRequested = false;
        this.immediateFlushRequested = false;
        void this.flush(immediate).catch(() => undefined);
      }
    }
  }

  async clear(): Promise<void> {
    if (this.localWrites()) throw new Error('Lokale Speicherung ist noch ausstehend.');
    const db = await openDb();
    try {
      const transaction = db.transaction([queueStore, mapStore], 'readwrite');
      const done = transactionDone(transaction);
      await Promise.all([
        done,
        (async () => {
          const count = await request(transaction.objectStore(queueStore).count());
          if (count || this.localWrites()) throw new Error('Synchronisierung ist noch ausstehend.');
          await request(transaction.objectStore(mapStore).clear());
        })(),
      ]);
    } finally {
      db.close();
    }
    await this.refreshStatus();
  }

  /** Patient IDs (provisional and real) that still have unsent writes on this device. */
  async pendingPatientIds(): Promise<Set<number>> {
    const ids = new Set<number>(this.unsavedProtocols.keys());
    for (const item of await this.items()) {
      const id = item.type === 'manual-patient' ? item.provisionalId : item.patientId;
      ids.add(id);
      ids.add(await this.realPatientId(id));
    }
    return ids;
  }

  async retry(id: string): Promise<void> {
    const item = (await this.items()).find((candidate) => candidate.id === id);
    if (!item) return;
    await this.replaceIfCurrent(item, { ...item, state: 'pending', nextAttemptAt: null });
    await this.refreshStatus();
    await this.flush(true);
  }

  /** JSON backup of a blocked item and every queued write that depends on it. */
  async exportBlocked(id: string): Promise<Blob> {
    const related = await this.withDependents(id);
    if (!related.length) throw new Error('Eintrag nicht gefunden.');
    for (const item of related) this.exportedIds.add(item.id);
    const payload = { exportedAt: new Date().toISOString(), items: related };
    return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  }

  /** Removes a blocked item and its dependents; refused until they were exported. */
  async discard(id: string): Promise<void> {
    const related = await this.withDependents(id);
    if (related.some((item) => !this.exportedIds.has(item.id))) {
      throw new Error('Eintrag zuerst als Datei sichern.');
    }
    await this.withStore(queueStore, 'readwrite', async (store) => {
      for (const item of related) await request(store.delete(item.id));
    });
    await this.refreshStatus();
  }

  private async withDependents(id: string): Promise<QueueItem[]> {
    const items = await this.items();
    const root = items.find((item) => item.id === id);
    if (!root) return [];
    if (root.type !== 'manual-patient') return [root];
    return [
      root,
      ...items.filter(
        (item) => item.type !== 'manual-patient' && item.patientId === root.provisionalId,
      ),
    ];
  }

  private async replay(item: PendingWrite): Promise<boolean | ProtocolSaveResult> {
    const patientId = await this.realPatientId(item.patientId);
    if (patientId < 0) return false;
    if (item.type === 'triage') {
      const patient = await firstValueFrom(this.api.updateTriage(patientId, item.body));
      this.responderState.replacePatient(patientId, patient);
      return true;
    }
    if (item.type === 'location') {
      const patient = await firstValueFrom(this.api.updatePatientLocation(patientId, item.body));
      this.responderState.replacePatient(patientId, patient);
      return true;
    }
    if (item.type === 'body-part') {
      await firstValueFrom(this.api.toggleBodyPart({ ...item.body, idpatient: patientId }));
      return true;
    }
    const record = await firstValueFrom(this.api.saveProtokollPage1(patientId, item.body));
    return {
      patientId,
      sourcePatientId: item.patientId,
      writeId: item.writeId ?? item.createdAt,
      record,
    };
  }

  private async add(item: QueueItem): Promise<void> {
    await this.withStore(queueStore, 'readwrite', (store) => request(store.put(item)));
    await this.refreshStatus();
  }

  private async deleteIfCurrent(item: QueueItem): Promise<boolean> {
    const deleted = await this.withStore(queueStore, 'readwrite', async (store) => {
      const current = await request<QueueItem | undefined>(store.get(item.id));
      if (!sameQueueWrite(current, item)) return false;
      await request(store.delete(item.id));
      return true;
    });
    if (deleted) this.syncStatus.markQueueFlushed();
    return deleted;
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
    // 401 invalidates every protected write, so the flush pauses. Any other rejection (e.g. 403
    // after a scene closed) blocks only this item; 408/429 are transient and retried.
    const authBlocked = status === 401;
    const permanentlyBlocked =
      status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
    const attemptCount = (item.attemptCount ?? 0) + 1;
    const retryDelay = Math.min(60_000, 1000 * 2 ** Math.min(attemptCount - 1, 6));
    await this.replaceIfCurrent(item, {
      ...item,
      state: permanentlyBlocked ? 'blocked' : 'retrying',
      attemptCount,
      lastAttemptAt: new Date().toISOString(),
      lastError: status === null ? 'Netzwerkfehler' : apiErrorMessage(error, `HTTP ${status}`),
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
        await this.reconcilePatientIds(mapping.provisionalId, mapping.realId, mapping.patient);
      }
    }
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
    let items: QueueItem[];
    try {
      items = await this.items();
    } catch {
      this.syncStatus.queueReady.set(false);
      this.syncStatus.lastQueueError.set('Lokale Warteschlange konnte nicht gelesen werden.');
      return;
    }
    const failed = items.filter((item) => item.lastError);
    this.blockedItems.set(
      items
        // 401 items resume after re-login, but an expired QR code or closed account can never
        // log in again, so they must stay exportable too.
        .filter((item) => item.state === 'blocked')
        .map((item) => ({
          id: item.id,
          type: item.type,
          patientId: item.type === 'manual-patient' ? item.provisionalId : item.patientId,
          errorStatus: item.errorStatus ?? null,
          lastError: item.lastError ?? null,
          createdAt: item.createdAt,
        })),
    );
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
      const transaction = db.transaction(name, mode);
      const [result] = await Promise.all([
        work(transaction.objectStore(name)),
        transactionDone(transaction),
      ]);
      return result;
    } finally {
      db.close();
    }
  }
}

function protocolDraft(item: ProtocolWrite): ProtokollDraftRecord {
  return {
    patientId: item.patientId,
    sceneId: item.sceneId,
    status: item.body.status ?? 'draft',
    updatedAt: item.body.clientUpdatedAt ?? item.createdAt,
    finalizedAt: item.finalizedAt,
    formState: item.body.formState,
  };
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
