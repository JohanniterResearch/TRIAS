import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOfflineQueue, type QueueItem, type QueueTransport } from './queue';
import { memoryStorage } from './queueStorage';

// Parity plan WP 6.3/6.4 and decision D11: the queue rules of the Ambulanzsystem client, plus
// per-session ownership. Storage is the in-memory adapter with the IndexedDB contract.

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const offline = () => Object.assign(new Error('Network Error'), { offline: true });

let owner: string | null;
let storage: ReturnType<typeof memoryStorage<QueueItem>>;
let transport: { [K in keyof QueueTransport]: ReturnType<typeof vi.fn> };

function makeQueue(extra: Partial<Parameters<typeof createOfflineQueue>[0]> = {}) {
  return createOfflineQueue({
    storage,
    transport: transport as unknown as QueueTransport,
    currentOwner: () => owner,
    isTransportFailure: (error) => Boolean((error as { offline?: boolean }).offline),
    httpStatus: (error) => (error as { status?: number }).status,
    errorMessage: (_error, fallback) => fallback,
    protocolDelayMs: 0,
    ...extra,
  });
}

const draft = (text: string, status: 'draft' | 'finalized' = 'draft') =>
  ({ status, formState: { incident: { ambulanzort: text } } }) as never;

beforeEach(() => {
  owner = 'qr:1';
  storage = memoryStorage<QueueItem>();
  transport = {
    createManualPatient: vi.fn(async (_owner, body) => ({ id: 77, humanReadableId: 'M-0077', clientGeneratedId: body.clientGeneratedId })),
    triage: vi.fn(async () => ({})),
    location: vi.fn(async () => ({})),
    bodyPart: vi.fn(async () => ({})),
    protocol: vi.fn(async (_owner, patientId) => ({ patientId, status: 'draft' })),
  };
});

describe('ownership', () => {
  it('keeps the unsent protocol of one session when another session edits the same patient', async () => {
    const queue = makeQueue();
    await queue.queueProtocol(5, draft('von A'));
    owner = 'qr:2';
    await queue.queueProtocol(5, draft('von B'));

    const items = await storage.all();
    expect(items.map((item) => [item.owner, (item as { body: { formState: unknown } }).body.formState])).toEqual([
      ['qr:1', { incident: { ambulanzort: 'von A' } }],
      ['qr:2', { incident: { ambulanzort: 'von B' } }],
    ]);
  });

  it('sends only the signed-in session\'s items, each under its owner', async () => {
    const queue = makeQueue();
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    owner = 'qr:2';
    await queue.queueTriage(6, { triageColor: 'gelb' } as never);
    await queue.flush(true);

    expect(transport.triage.mock.calls).toEqual([['qr:2', 6, { triageColor: 'gelb' }]]);
    expect(queue.getStatus()).toMatchObject({ pendingCount: 0, foreignCount: 1 });
  });

  it('stops when another account signs in during a flush, without marking anything failed', async () => {
    const queue = makeQueue();
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.queueTriage(6, { triageColor: 'gelb' } as never);
    transport.triage.mockImplementationOnce(async () => {
      owner = 'qr:2';
      throw new Error('refused before sending');
    });
    await queue.flush(true);

    expect(transport.triage).toHaveBeenCalledTimes(1);
    expect((await storage.all()).every((item) => item.attemptCount === 0 && item.lastError === null)).toBe(true);
  });

  it('sends nothing more after a sign-in that happened while one item was being sent', async () => {
    const queue = makeQueue();
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.queueTriage(6, { triageColor: 'gelb' } as never);
    transport.triage.mockImplementationOnce(async () => {
      owner = 'qr:2';
      return {};
    });
    await queue.flush(true);
    expect(transport.triage).toHaveBeenCalledTimes(1);
  });

  it('refuses to queue without a session', async () => {
    owner = null;
    await expect(makeQueue().queueTriage(5, { triageColor: 'rot' } as never)).rejects.toThrow('Keine Anmeldung');
  });
});

describe('failures', () => {
  it('retries a transport failure with backoff and does not resend before it is due', async () => {
    const queue = makeQueue();
    transport.triage.mockRejectedValueOnce(offline());
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.flush(true);
    await queue.flush(); // the 30 s timer

    expect(transport.triage).toHaveBeenCalledTimes(1);
    const [item] = await storage.all();
    expect(item).toMatchObject({ state: 'retrying', attemptCount: 1, lastError: 'Netzwerkfehler' });
    expect(Date.parse(item.nextAttemptAt!)).toBeGreaterThan(Date.now());

    await queue.flush(true); // start, back online, or the retry button
    expect(transport.triage).toHaveBeenCalledTimes(2);
  });

  it('a 401 pauses the flush and is not offered as a blocked item', async () => {
    const queue = makeQueue();
    transport.triage.mockRejectedValueOnce(httpError(401));
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.queueTriage(6, { triageColor: 'gelb' } as never);
    await queue.flush(true);

    expect(transport.triage).toHaveBeenCalledTimes(1);
    expect(queue.getStatus().blocked).toEqual([]);
    await queue.flush(true); // renewed session: both go out
    expect(transport.triage).toHaveBeenCalledTimes(3);
  });

  it('blocks a refused item; discard needs an export first', async () => {
    const queue = makeQueue();
    transport.triage.mockRejectedValue(httpError(400));
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.flush(true);

    const [blocked] = queue.getStatus().blocked;
    expect(blocked).toMatchObject({ type: 'triage', patientId: 5, errorStatus: 400 });
    await expect(queue.discard(blocked.id)).rejects.toThrow('zuerst als Datei sichern');
    const file = await queue.exportItems(blocked.id);
    expect(JSON.parse(await file.text()).items).toHaveLength(1);
    await queue.discard(blocked.id);
    expect(await storage.all()).toEqual([]);
  });

  it.each([408, 429, 500])('retries HTTP %i instead of blocking', async (status) => {
    const queue = makeQueue();
    transport.triage.mockRejectedValueOnce(httpError(status));
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.flush(true);
    expect((await storage.all())[0].state).toBe('retrying');
  });
});

describe('provisional patients (WP 6.4)', () => {
  it('creates a local patient, replays its writes to the real id and reports the mapping', async () => {
    const mapped = vi.fn();
    const queue = makeQueue({ onPatientMapped: mapped });
    const local = await queue.createProvisionalPatient({ operationSceneId: 3, clientGeneratedId: 'cid-1' } as never);
    expect(local.id).toBeLessThan(0);
    expect(local.humanReadableId).toMatch(/^Lokal-\d{6}$/);
    expect(local.clientGeneratedId).toBe('cid-1');
    await queue.queueTriage(local.id, { triageColor: 'rot' } as never);
    await queue.queueProtocol(local.id, draft('Zelt'));
    expect(await queue.hasPendingFor(local.id)).toBe(true);

    await queue.flush(true);

    expect(transport.createManualPatient).toHaveBeenCalledWith('qr:1', { operationSceneId: 3, clientGeneratedId: 'cid-1' });
    expect(transport.triage).toHaveBeenCalledWith('qr:1', 77, { triageColor: 'rot' });
    expect(transport.protocol).toHaveBeenCalledWith('qr:1', 77, expect.anything());
    expect(mapped).toHaveBeenCalledWith(local.id, expect.objectContaining({ id: 77 }), 'qr:1'); // the creating session (L2)
    expect(await queue.realPatientId(local.id)).toBe(77);
    expect(await storage.all()).toEqual([]);
  });

  it('holds dependent writes while the patient is not created yet', async () => {
    const queue = makeQueue();
    transport.createManualPatient.mockRejectedValueOnce(offline());
    const local = await queue.createProvisionalPatient({ operationSceneId: 3 } as never);
    await queue.queueTriage(local.id, { triageColor: 'rot' } as never);
    await queue.flush(true);
    expect(transport.triage).not.toHaveBeenCalled();
  });

  it('exports and discards a local patient together with its dependent writes', async () => {
    const queue = makeQueue();
    transport.createManualPatient.mockRejectedValue(httpError(403));
    const local = await queue.createProvisionalPatient({ operationSceneId: 3 } as never);
    await queue.queueTriage(local.id, { triageColor: 'rot' } as never);
    await queue.flush(true);
    const [blocked] = queue.getStatus().blocked;
    expect(JSON.parse(await (await queue.exportItems(blocked.id)).text()).items).toHaveLength(2);
    await queue.discard(blocked.id);
    expect(await storage.all()).toEqual([]);
  });
});

describe('protocol', () => {
  it('a newer save replaces the unsent one; only the latest answer is reported', async () => {
    const saved = vi.fn();
    const queue = makeQueue({ onProtocolSaved: saved });
    let release: () => void = () => undefined;
    transport.protocol.mockImplementationOnce(async (_o, patientId) => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { patientId, status: 'draft' };
    });
    await queue.queueProtocol(5, draft('alt'));
    const flushing = queue.flush(true);
    await vi.waitFor(() => expect(transport.protocol).toHaveBeenCalledTimes(1));
    const newer = await queue.queueProtocol(5, draft('neu'));
    release();
    await flushing;
    expect(saved).not.toHaveBeenCalled(); // the answer to "alt" is not the latest state

    await queue.flush(true);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ writeId: newer })));
    expect(transport.protocol.mock.calls[1][2].formState).toEqual({ incident: { ambulanzort: 'neu' } });
  });

  it('flags drafts sent at logout, not finalized protocols (D11)', async () => {
    const queue = makeQueue();
    await queue.queueProtocol(5, draft('Entwurf'));
    await queue.queueProtocol(6, draft('fertig', 'finalized'));
    transport.protocol.mockClear();
    await queue.flushAtLogout();

    const bodies = Object.fromEntries(transport.protocol.mock.calls.map(([, patientId, body]) => [patientId, body]));
    expect(bodies[5]).toMatchObject({ status: 'draft', sentAtLogout: true });
    expect(bodies[6]).not.toHaveProperty('sentAtLogout');
  });

  it('at logout sends even what waits for its backoff', async () => {
    const queue = makeQueue();
    transport.protocol.mockRejectedValueOnce(offline());
    await queue.queueProtocol(5, draft('Entwurf'));
    await queue.flush(true);
    await queue.flushAtLogout();
    expect(transport.protocol).toHaveBeenCalledTimes(2);
    expect(await storage.all()).toEqual([]);
  });
});

it('reports storage failures instead of losing the write silently', async () => {
  const queue = makeQueue();
  storage.failNextPut = true;
  await expect(queue.queueTriage(5, { triageColor: 'rot' } as never)).rejects.toThrow('storage failed');
});

describe('other sessions\' items (D11)', () => {
  it('can be exported, and only exported ones discarded', async () => {
    const queue = makeQueue();
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    owner = 'user:9';
    expect(await queue.discardExportedForeign()).toBe(0);
    const file = JSON.parse(await (await queue.exportForeign()).text());
    expect(file.items.map((item: QueueItem) => item.owner)).toEqual(['qr:1']);
    expect(await queue.discardExportedForeign()).toBe(1);
    expect(await storage.all()).toEqual([]);
  });
});

describe('security review 4', () => {
  it('M1: the logout send is bound to the account logging out', async () => {
    const queue = makeQueue();
    await queue.queueProtocol(5, draft('von A'));
    let release: () => void = () => undefined;
    transport.triage.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
    await queue.queueTriage(6, { triageColor: 'rot' } as never);
    transport.protocol.mockClear();
    const hung = queue.flush(true); // A's regular send hangs on the triage
    const logout = queue.flushAtLogout(100);
    await logout; // the deadline passes: logout goes ahead
    owner = 'qr:2';
    await queue.queueProtocol(7, draft('von B'));
    release();
    await hung;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const bodies = transport.protocol.mock.calls.filter(([o]) => o === 'qr:2').map(([, , body]) => body);
    expect(bodies.every((body) => !('sentAtLogout' in body))).toBe(true);
  });

  it('M1: when the waiting logout send runs, nothing is sent if another account signed in meanwhile', async () => {
    const queue = makeQueue({ protocolDelayMs: 60_000 });
    let release: () => void = () => undefined;
    transport.triage.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));
    await queue.queueTriage(6, { triageColor: 'rot' } as never);
    const hung = queue.flush(true);
    const logout = queue.flushAtLogout(5_000);
    owner = 'qr:2';
    await queue.queueProtocol(7, draft('von B'));
    release();
    await hung;
    await logout;
    expect(transport.protocol).not.toHaveBeenCalled();
  });

  it('M6: the flag is stored on the item and survives an offline logout', async () => {
    const queue = makeQueue();
    transport.protocol.mockRejectedValue(offline());
    await queue.queueProtocol(5, draft('Entwurf'));
    await queue.flushAtLogout();
    const [item] = await storage.all();
    expect((item as { body: { sentAtLogout?: boolean } }).body.sentAtLogout).toBe(true);
  });

  it('L3: a backup covers the exported write only, not a newer one under the same id', async () => {
    const queue = makeQueue();
    transport.location.mockRejectedValue(httpError(400));
    await queue.queueLocation(5, { lat: 1, lng: 1 } as never);
    await queue.flush(true);
    const [blocked] = queue.getStatus().blocked;
    await queue.exportItems(blocked.id);
    await queue.queueLocation(5, { lat: 2, lng: 2 } as never); // newer value, same id
    await expect(queue.discard(blocked.id)).rejects.toThrow('zuerst als Datei sichern');
  });

  it('L7: sends run through the cross-tab lock', async () => {
    const exclusive = vi.fn(async (task: () => Promise<void>) => task());
    const queue = makeQueue({ exclusive });
    await queue.queueTriage(5, { triageColor: 'rot' } as never);
    await queue.flush(true);
    expect(exclusive).toHaveBeenCalled();
    expect(transport.triage).toHaveBeenCalledTimes(1);
  });

  it('L1: the provisional-id mapping keeps no patient data', async () => {
    const queue = makeQueue();
    const local = await queue.createProvisionalPatient({ operationSceneId: 3 } as never);
    await queue.flush(true);
    expect(await queue.mappings()).toEqual([{ provisionalId: local.id, realId: 77, patient: null }]);
  });
});

describe('compare-and-set (final review M2)', () => {
  it('a newer write stored between a check and the removal is kept', async () => {
    const queue = makeQueue();
    await queue.queueProtocol(5, draft('alt'));
    const [sent] = await storage.all();
    // A newer save of the same page lands right after any read of the item: a non-atomic
    // "read, then delete" would remove it.
    const read = storage.get.bind(storage);
    let armed = true;
    storage.get = async (id) => {
      const value = await read(id);
      if (armed && value) {
        armed = false;
        await storage.put({ ...value, writeId: 'newer', body: { ...(value as { body: object }).body, formState: { incident: { ambulanzort: 'neu' } } } } as QueueItem);
      }
      return value;
    };
    const put = storage.put.bind(storage);
    // Atomic storage: the newer write arrives just before the swap instead.
    const swap = storage.swapIfWrite.bind(storage);
    storage.swapIfWrite = async (id, writeId, replacement) => {
      if (armed) {
        armed = false;
        await put({ ...sent, writeId: 'newer', body: { ...(sent as { body: object }).body, formState: { incident: { ambulanzort: 'neu' } } } } as QueueItem);
      }
      return swap(id, writeId, replacement);
    };

    await queue.flush(true);
    expect(transport.protocol).toHaveBeenCalledTimes(1);
    const kept = await read(sent.id);
    expect((kept as { writeId: string } | undefined)?.writeId).toBe('newer');
  });
});

it('two local patients created in the same millisecond get different ids (final review L3)', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  try {
    const queue = makeQueue();
    const a = await queue.createProvisionalPatient({ operationSceneId: 7 } as never);
    const b = await queue.createProvisionalPatient({ operationSceneId: 7 } as never);
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBeLessThan(0);
  } finally {
    vi.restoreAllMocks();
  }
});
