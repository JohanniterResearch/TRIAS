import type { Body, Patient } from '../api/endpoints';
import type { PatientMapping, QueueStorage } from './queueStorage';

// Offline write queue (parity plan WP 6.3/6.4), a framework-free port of the Ambulanzsystem
// OfflineQueueService: the same item types and the same replay, retry and block rules. One
// addition: each item records the session that made it, and only that session replays it, so a
// handed-over device never sends A's work under B's identity (security review 2, finding 1).

type ManualPatientRequest = Body<'/api/persons/manual', 'post'>;
type TriageRequest = Body<'/api/persons/{id}/update-triage-color', 'post'>;
type LocationRequest = Body<'/api/persons/{id}/location', 'post'>;
type BodyPartRequest = Body<'/api/body-parts', 'put'>;
/** Server vocabulary: the protocol is encoded before it is queued. */
type ProtocolRequest = Body<'/api/persons/{patientId}/ambulanzprotokoll-page1', 'put'>;

type Meta = {
  writeId: string;
  owner: string;
  /** blocked: refused by the server (4xx), waits for retry, export or discard. */
  state: 'pending' | 'retrying' | 'blocked';
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  errorStatus: number | null;
  nextAttemptAt: string | null;
};

export type QueueItem = Meta & { id: string; createdAt: string } & (
    | { type: 'manual-patient'; body: ManualPatientRequest; provisionalId: number }
    | { type: 'triage'; patientId: number; body: TriageRequest }
    | { type: 'location'; patientId: number; body: LocationRequest }
    | { type: 'body-part'; patientId: number; body: BodyPartRequest }
    | { type: 'protocol'; patientId: number; body: ProtocolRequest; sceneId?: number | null }
  );

type Write = Exclude<QueueItem, { type: 'manual-patient' }>;
type NewItem<T extends QueueItem['type']> = Omit<Extract<QueueItem, { type: T }>, keyof Meta | 'createdAt'>;

export interface ProtocolSaved {
  patientId: number;
  sourcePatientId: number;
  writeId: string;
  /** The server record, server vocabulary. */
  record: unknown;
}

/** Every call carries the item's owner; the transport must refuse to send under another session. */
export interface QueueTransport {
  createManualPatient(owner: string, body: ManualPatientRequest): Promise<Patient>;
  triage(owner: string, patientId: number, body: TriageRequest): Promise<Patient>;
  location(owner: string, patientId: number, body: LocationRequest): Promise<Patient>;
  bodyPart(owner: string, body: BodyPartRequest): Promise<unknown>;
  protocol(owner: string, patientId: number, body: ProtocolRequest): Promise<unknown>;
}

export interface QueueOptions {
  storage: QueueStorage<QueueItem>;
  transport: QueueTransport;
  /** Identity of the signed-in session (`type:sub`), null when nobody is signed in. */
  currentOwner: () => string | null;
  isTransportFailure: (error: unknown) => boolean;
  httpStatus: (error: unknown) => number | undefined;
  errorMessage: (error: unknown, fallback: string) => string;
  onPatientMapped?: (provisionalId: number, patient: Patient, owner: string) => void;
  onProtocolSaved?: (saved: ProtocolSaved) => void;
  /** Delay before a protocol item is sent, so typing does not send every keystroke. */
  protocolDelayMs?: number;
  /** Runs a flush exclusively across tabs; skips it when another tab is sending. */
  exclusive?: (task: () => Promise<void>) => Promise<void>;
}

export interface BlockedItem {
  id: string;
  type: QueueItem['type'];
  patientId: number;
  errorStatus: number | null;
  lastError: string | null;
  createdAt: string;
}

export interface QueueStatus {
  ready: boolean;
  /** Unsent items of the signed-in session. */
  pendingCount: number;
  /** Unsent items of other sessions on this device (only their number is shown). */
  foreignCount: number;
  failedCount: number;
  oldestPendingAt: string | null;
  lastError: string | null;
  blocked: BlockedItem[];
  lastFlushAt: string | null;
  storageError: string | null;
}

const randomId = () => crypto.randomUUID();
const patientOf = (item: QueueItem) => (item.type === 'manual-patient' ? item.provisionalId : item.patientId);

export function createOfflineQueue(options: QueueOptions) {
  const { storage, transport } = options;
  const protocolDelay = options.protocolDelayMs ?? 800;
  const listeners = new Set<(status: QueueStatus) => void>();
  const protocolNotBefore = new Map<number, number>();
  const exportedIds = new Set<string>(); // write ids
  const exclusive = options.exclusive ?? ((task: () => Promise<void>) => task());
  let status: QueueStatus = {
    ready: false,
    pendingCount: 0,
    foreignCount: 0,
    failedCount: 0,
    oldestPendingAt: null,
    lastError: null,
    blocked: [],
    lastFlushAt: null,
    storageError: null,
  };
  let flushing = false;
  let flushAgain: { immediate: boolean } | null = null;
  let protocolTimer: ReturnType<typeof setTimeout> | undefined;

  const items = async () => (await storage.all()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mine = (item: QueueItem) => item.owner === options.currentOwner();

  async function refresh(): Promise<void> {
    let all: QueueItem[];
    try {
      all = await items();
    } catch {
      publish({ ...status, ready: false, storageError: 'Lokale Warteschlange konnte nicht gelesen werden.' });
      return;
    }
    const own = all.filter(mine);
    const failed = own.filter((item) => item.lastError);
    publish({
      ...status,
      ready: true,
      storageError: null,
      pendingCount: own.length,
      foreignCount: all.length - own.length,
      failedCount: failed.length,
      oldestPendingAt: own[0]?.createdAt ?? null,
      lastError: failed[0]?.lastError ?? null,
      blocked: own
        .filter((item) => item.state === 'blocked')
        .map((item) => ({
          id: item.id,
          type: item.type,
          patientId: patientOf(item),
          errorStatus: item.errorStatus,
          lastError: item.lastError,
          createdAt: item.createdAt,
        })),
    });
  }

  function publish(next: QueueStatus) {
    status = next;
    for (const listener of listeners) listener(status);
  }

  /** Builds an item for the signed-in session. Ids that coalesce carry the owner, so a newer
   * value of one session never replaces another session's unsent one. With `expectedOwner` (the
   * session that made the change) nothing is queued once another session is signed in. */
  function withMeta<T extends QueueItem['type']>(build: (owner: string) => NewItem<T>, expectedOwner?: string): QueueItem {
    const owner = options.currentOwner();
    if (!owner) throw new Error('Keine Anmeldung: Eintrag kann nicht gespeichert werden.');
    if (expectedOwner !== undefined && owner !== expectedOwner) throw new Error('Andere Anmeldung aktiv: Eintrag wird nicht gespeichert.');
    return {
      ...build(owner),
      createdAt: new Date().toISOString(),
      writeId: randomId(),
      owner,
      state: 'pending',
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      errorStatus: null,
      nextAttemptAt: null,
    } as unknown as QueueItem;
  }

  async function add(item: QueueItem): Promise<void> {
    try {
      await storage.put(item);
    } finally {
      await refresh();
    }
  }

  async function realPatientId(patientId: number): Promise<number> {
    if (patientId >= 0) return patientId;
    return (await storage.mapping(patientId))?.realId ?? patientId;
  }

  // Compare-and-set in one storage transaction: a write queued meanwhile under the same id (a
  // newer intent) is never overwritten or deleted (final review M2).
  async function replaceIfCurrent(original: QueueItem, replacement: QueueItem): Promise<boolean> {
    return storage.swapIfWrite(original.id, original.writeId, replacement);
  }

  async function deleteIfCurrent(item: QueueItem): Promise<boolean> {
    if (!(await storage.swapIfWrite(item.id, item.writeId, null))) return false; // replaced by a newer intent meanwhile
    status = { ...status, lastFlushAt: new Date().toISOString() };
    return true;
  }

  async function recordFailure(item: QueueItem, error: unknown): Promise<boolean> {
    const statusCode = options.isTransportFailure(error) ? null : (options.httpStatus(error) ?? null);
    // 401 pauses the whole flush (the session must be renewed); another 4xx blocks only this item
    // until retried, exported or discarded; 408/429 and transport failures are retried with backoff.
    const authBlocked = statusCode === 401;
    const blocked = statusCode !== null && statusCode >= 400 && statusCode < 500 && ![401, 408, 429].includes(statusCode);
    const attemptCount = item.attemptCount + 1;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(attemptCount - 1, 6));
    await replaceIfCurrent(item, {
      ...item,
      state: blocked ? 'blocked' : 'retrying',
      attemptCount,
      lastAttemptAt: new Date().toISOString(),
      lastError: statusCode === null ? 'Netzwerkfehler' : options.errorMessage(error, `HTTP ${statusCode}`),
      errorStatus: statusCode,
      // After a 401 the item waits for a renewed session, not for a timer.
      nextAttemptAt: blocked || authBlocked ? null : new Date(Date.now() + delay).toISOString(),
    });
    return authBlocked;
  }

  async function replay(item: Write): Promise<false | true | ProtocolSaved> {
    const patientId = await realPatientId(item.patientId);
    if (patientId < 0) return false; // its manual patient is not on the server yet
    if (item.type === 'triage') await transport.triage(item.owner, patientId, item.body);
    else if (item.type === 'location') await transport.location(item.owner, patientId, item.body);
    else if (item.type === 'body-part') await transport.bodyPart(item.owner, { ...item.body, idpatient: patientId });
    else return { patientId, sourcePatientId: item.patientId, writeId: item.writeId, record: await transport.protocol(item.owner, patientId, item.body) };
    return true;
  }

  /** Sends due items of the signed-in session; with `expectedOwner`, only while it is still signed in. */
  async function flush(immediate = false, expectedOwner?: string): Promise<void> {
    if (flushing) {
      // A request made during a flush runs after it, keeping an explicit "now" (retry button).
      flushAgain = { immediate: immediate || Boolean(flushAgain?.immediate) };
      return;
    }
    flushing = true;
    try {
      const owner = options.currentOwner();
      if (!owner || (expectedOwner !== undefined && owner !== expectedOwner)) return;
      // One tab sends at a time (security review 4, L7); another tab holding the lock skips this round.
      await exclusive(() => sendItems(owner, immediate));
    } finally {
      flushing = false;
      await refresh();
      const again = flushAgain;
      flushAgain = null;
      if (again) void flush(again.immediate);
    }
  }

  async function sendItems(owner: string, immediate: boolean): Promise<void> {
    for (const item of await items()) {
      // Another account signed in meanwhile: stop, nothing is sent or marked failed for it.
      if (options.currentOwner() !== owner) break;
      if (item.owner !== owner) continue;
      if (item.type === 'protocol' && !immediate && (protocolNotBefore.get(item.patientId) ?? 0) > Date.now()) continue;
      if (item.state === 'blocked') continue;
      // The timer respects the backoff; an explicit send (start, back online, retry, logout) does not.
      if (!immediate && item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.now()) continue;
      try {
        if (item.type === 'manual-patient') {
          const patient = await transport.createManualPatient(item.owner, item.body);
          // Ids only: no patient data stays in the mapping (security review 4, L1).
          await storage.commitMapping(item.id, { provisionalId: item.provisionalId, realId: patient.id, patient: null } satisfies PatientMapping);
          options.onPatientMapped?.(item.provisionalId, patient, item.owner);
          continue;
        }
        const result = await replay(item);
        if (result === false) {
          await replaceIfCurrent(item, { ...item, state: 'retrying', lastError: 'Patientenzuordnung ausstehend', nextAttemptAt: null });
          continue;
        }
        const deleted = await deleteIfCurrent(item);
        if (deleted && item.type === 'protocol') protocolNotBefore.delete(item.patientId);
        // A newer intent replaced this protocol item meanwhile: its answer is not the latest.
        if (deleted && typeof result === 'object') options.onProtocolSaved?.(result);
      } catch (error) {
        if (options.currentOwner() !== owner) break; // refused before sending: not a failure
        if (await recordFailure(item, error)) break;
      }
    }
  }

  function scheduleProtocolFlush() {
    clearTimeout(protocolTimer);
    protocolTimer = setTimeout(() => void flush(), protocolDelay);
  }

  async function pendingFor(patientId: number): Promise<QueueItem[]> {
    const target = await realPatientId(patientId);
    const result: QueueItem[] = [];
    for (const item of await items()) {
      if (mine(item) && (await realPatientId(patientOf(item))) === target) result.push(item);
    }
    return result;
  }

  async function withDependents(id: string, ownOnly: boolean): Promise<QueueItem[]> {
    const all = (await items()).filter((item) => (ownOnly ? mine(item) : true));
    const root = all.find((item) => item.id === id);
    if (!root) return [];
    if (root.type !== 'manual-patient') return [root];
    return [root, ...all.filter((item) => item.type !== 'manual-patient' && item.patientId === root.provisionalId)];
  }

  const api = {
    getStatus: () => status,
    subscribe(listener: (status: QueueStatus) => void) {
      listeners.add(listener);
      listener(status);
      return () => void listeners.delete(listener);
    },
    refresh,
    flush: (immediate = false) => flush(immediate),

    /**
     * Last send before logout (D11): every unsent item of this session now, drafts flagged
     * `sentAtLogout`. Waits for a running flush first. Whatever fails stays queued for the same
     * account's next sign-in on this device; logout itself is never blocked.
     */
    async flushAtLogout(waitMs = 5_000): Promise<void> {
      // Bound to the account logging out: if another one signs in meanwhile, nothing of it is
      // sent or flagged (security review 4, M1).
      const owner = options.currentOwner();
      if (!owner) return;
      // The flag is stored on the item, so it survives an offline logout and is still sent at
      // this account's next sign-in (M6). A later edit replaces the item without it.
      for (const item of await items()) {
        if (item.owner === owner && item.type === 'protocol' && item.body.status === 'draft' && !item.body.sentAtLogout) {
          await replaceIfCurrent(item, { ...item, body: { ...item.body, sentAtLogout: true } });
        }
      }
      const deadline = Date.now() + waitMs;
      while (flushing && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      if (flushing) return; // a hung send: logout goes ahead, the items stay queued
      await flush(true, owner);
    },
    realPatientId,

    /** An offline manual patient: provisional id -Date.now(), label Lokal-NNNNNN (WP 6.4). */
    async createProvisionalPatient(body: ManualPatientRequest, expectedOwner?: string): Promise<Patient> {
      // Unique on this device: two local patients in the same millisecond must not share an id
      // (their writes and mappings are keyed by it, final review L3).
      let provisionalId = -Date.now();
      const taken = async (id: number) =>
        Boolean(await storage.mapping(id)) || (await items()).some((item) => item.type === 'manual-patient' && item.provisionalId === id);
      while (await taken(provisionalId)) provisionalId -= 1;
      const clientGeneratedId = body.clientGeneratedId ?? randomId();
      await add(withMeta<'manual-patient'>(() => ({ id: randomId(), type: 'manual-patient', body: { ...body, clientGeneratedId }, provisionalId }), expectedOwner));
      const now = new Date().toISOString();
      return {
        id: provisionalId,
        humanReadableId: `Lokal-${String(Math.abs(provisionalId)).slice(-6)}`,
        clientGeneratedId,
        name: body.name ?? null,
        operationSceneId: body.operationSceneId,
        createdAt: now,
        updatedAt: now,
      };
    },

    queueTriage: async (patientId: number, body: TriageRequest, expectedOwner?: string) =>
      add(withMeta<'triage'>(() => ({ id: `triage:${patientId}:${randomId()}`, type: 'triage', patientId, body }), expectedOwner)),

    // One key per patient (location) or region (body part): a newer value replaces an unsent one.
    queueLocation: async (patientId: number, body: LocationRequest, expectedOwner?: string) =>
      add(withMeta<'location'>((owner) => ({ id: `location:${owner}:${patientId}`, type: 'location', patientId, body: { ...body, clientUpdatedAt: body.clientUpdatedAt ?? new Date().toISOString() } }), expectedOwner)),

    queueBodyPart: async (patientId: number, body: BodyPartRequest, expectedOwner?: string) =>
      add(withMeta<'body-part'>((owner) => ({ id: `body-part:${owner}:${patientId}:${body.bodyPartId}`, type: 'body-part', patientId, body }), expectedOwner)),

    async queueProtocol(patientId: number, body: ProtocolRequest, sceneId?: number | null): Promise<string> {
      const item = withMeta<'protocol'>((owner) => ({ id: `protocol:${owner}:${patientId}`, type: 'protocol', patientId, body: structuredClone(body), sceneId }));
      protocolNotBefore.set(patientId, Date.now() + protocolDelay);
      await add(item);
      scheduleProtocolFlush();
      return item.writeId;
    },

    pendingFor,
    async hasPendingFor(patientId: number) {
      return patientId < 0 || (await pendingFor(patientId)).length > 0;
    },
    async pendingTriage(patientId: number): Promise<TriageRequest[]> {
      return (await pendingFor(patientId))
        .filter((item): item is Extract<QueueItem, { type: 'triage' }> => item.type === 'triage')
        .sort((a, b) => (a.body.clientUpdatedAt ?? a.createdAt).localeCompare(b.body.clientUpdatedAt ?? b.createdAt))
        .map((item) => item.body);
    },
    async pendingProtocol(patientId: number) {
      const items = (await pendingFor(patientId)).filter((item): item is Extract<QueueItem, { type: 'protocol' }> => item.type === 'protocol');
      return items.at(-1) ?? null;
    },

    async retry(id: string) {
      const item = (await items()).find((candidate) => candidate.id === id && mine(candidate));
      if (!item) return;
      await replaceIfCurrent(item, { ...item, state: 'pending', nextAttemptAt: null });
      await refresh();
      await flush(true);
    },

    /** JSON backup of an item and every queued write that depends on it. */
    async exportItems(id: string, { includeForeign = false } = {}): Promise<Blob> {
      const related = await withDependents(id, !includeForeign);
      if (!related.length) throw new Error('Eintrag nicht gefunden.');
      for (const item of related) exportedIds.add(item.writeId);
      return new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items: related }, null, 2)], { type: 'application/json' });
    },

    /** Removes an item and its dependents; refused until they were exported. */
    async discard(id: string, { includeForeign = false } = {}) {
      const related = await withDependents(id, !includeForeign);
      // By write, not by id: a newer write under the same id was not part of the backup (L3).
      if (related.some((item) => !exportedIds.has(item.writeId))) throw new Error('Eintrag zuerst als Datei sichern.');
      // Only the exported writes: a newer one stored meanwhile under the same id stays.
      for (const item of related) await storage.swapIfWrite(item.id, item.writeId, null);
      await refresh();
    },

    /** Ids of unsent items of other sessions on this device. */
    async foreignItemIds(): Promise<string[]> {
      return (await items()).filter((item) => !mine(item)).map((item) => item.id);
    },

    /**
     * Backup of every other session's unsent items (staff on a handed-over device): they are
     * never sent under this session, and their owner may not come back (D11).
     */
    async exportForeign(): Promise<Blob> {
      const foreign = (await items()).filter((item) => !mine(item));
      for (const item of foreign) exportedIds.add(item.writeId);
      return new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), items: foreign }, null, 2)], { type: 'application/json' });
    },

    /** Removes the other sessions' items that were exported; returns how many. */
    async discardExportedForeign(): Promise<number> {
      const doomed = (await items()).filter((item) => !mine(item) && exportedIds.has(item.writeId));
      for (const item of doomed) await storage.swapIfWrite(item.id, item.writeId, null);
      await refresh();
      return doomed.length;
    },

    mappings: () => storage.mappings(),
  };
  return api;
}

export type OfflineQueue = ReturnType<typeof createOfflineQueue>;
