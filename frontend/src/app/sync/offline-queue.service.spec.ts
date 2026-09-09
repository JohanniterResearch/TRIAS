import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ApiClient, ApiRequestError } from '../api/api-client';
import { ProtokollDraftStore } from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { OfflineQueueService, sameQueueWrite } from './offline-queue.service';
import { SyncStatusService } from './sync-status.service';

describe('OfflineQueueService', () => {
  let api: { updateTriage: ReturnType<typeof vi.fn>; saveProtokollPage1: ReturnType<typeof vi.fn> };
  let sync: { setPending: ReturnType<typeof vi.fn>; markQueueFlushed: ReturnType<typeof vi.fn> };
  let service: OfflineQueueService;

  beforeEach(() => {
    vi.spyOn(OfflineQueueService.prototype as any, 'refreshStatus').mockResolvedValue(undefined);
    vi.spyOn(OfflineQueueService.prototype as any, 'reconcileMappings').mockResolvedValue(
      undefined,
    );
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    api = { updateTriage: vi.fn(), saveProtokollPage1: vi.fn() };
    sync = { setPending: vi.fn(), markQueueFlushed: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        OfflineQueueService,
        { provide: ApiClient, useValue: api },
        {
          provide: ResponderStateStore,
          useValue: { patient: () => null, replacePatient: vi.fn() },
        },
        { provide: TriageDraftStore, useValue: { rekey: vi.fn() } },
        {
          provide: ProtokollDraftStore,
          useValue: { rekey: vi.fn(), put: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: SyncStatusService, useValue: sync },
      ],
    });
    service = TestBed.inject(OfflineQueueService);
  });

  it('uses one intentional replacement key for full protocol snapshots', async () => {
    const added: any[] = [];
    vi.spyOn(service as any, 'add').mockImplementation((item: any) => added.push(item));

    await service.queueProtocol(7, { status: 'draft', formState: { version: 1 } } as any);
    await service.queueProtocol(7, { status: 'draft', formState: { version: 2 } } as any);

    expect(added[0].id).toBe('protocol:7');
    expect(added[1].id).toBe('protocol:7');
    expect(added[1].body.formState).toEqual({ version: 2 });
  });

  it('blocks logout from edit capture through failed persistence and retries the snapshot', async () => {
    let fail!: (error: Error) => void;
    const add = vi
      .spyOn(service as any, 'add')
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => (fail = reject)));
    const writing = service.queueProtocol(7, { status: 'draft', formState: { version: 1 } } as any);
    expect((service as any).localWrites()).toBe(1);
    await Promise.resolve();
    fail(new Error('quota'));
    await expect(writing).rejects.toThrow('quota');
    expect((service as any).localWrites()).toBe(1);
    await expect(service.clear()).rejects.toThrow('Lokale Speicherung');
    expect((await service.pendingProtocol(7))?.formState).toEqual({ version: 1 });
    add.mockResolvedValue(undefined);
    vi.spyOn(service as any, 'items').mockResolvedValue([]);
    await service.flush();
    expect(add).toHaveBeenCalledTimes(2);
    expect((service as any).localWrites()).toBe(0);
  });

  it('persists before starting the root transmission delay', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    vi.spyOn(service as any, 'add').mockImplementation(
      () => new Promise<void>((resolve) => (complete = resolve)),
    );
    const flush = vi.spyOn(service, 'flush').mockResolvedValue(undefined);
    const writing = service.queueProtocol(7, { status: 'draft', formState: {} } as any);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    expect(flush).not.toHaveBeenCalled();
    complete();
    await writing;
    await vi.advanceTimersByTimeAsync(799);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not treat a newer replacement as the in-flight protocol write', () => {
    const inFlight = { ...triage('protocol:7', 7), type: 'protocol', writeId: 'v1' } as any;
    const replacement = {
      ...inFlight,
      writeId: 'v2',
      body: { status: 'draft', formState: { version: 2 } },
    };

    expect(sameQueueWrite(replacement, inFlight)).toBe(false);
    expect(sameQueueWrite(inFlight, inFlight)).toBe(true);
  });

  it('retains provisional route identity while replay uses the reconciled patient ID', async () => {
    const item = {
      ...triage('protocol:-7', -7),
      type: 'protocol',
      writeId: 'v1',
      body: { status: 'draft', formState: {} },
    };
    vi.spyOn(service as any, 'items').mockResolvedValue([item]);
    vi.spyOn(service as any, 'realPatientId').mockResolvedValue(7);
    api.saveProtokollPage1.mockReturnValue(of({ patientId: 7, warnings: [] }));
    expect(await service.pendingProtocol(-7)).toMatchObject({ patientId: -7, writeId: 'v1' });
    expect(await (service as any).replay(item)).toMatchObject({
      patientId: 7,
      sourcePatientId: -7,
      writeId: 'v1',
    });
    expect(api.saveProtokollPage1).toHaveBeenCalledWith(7, item.body);
  });

  it('keeps disjoint triage intents as separate queue events', async () => {
    const added: any[] = [];
    vi.spyOn(service as any, 'add').mockImplementation((item: any) => added.push(item));

    await service.queueTriage(7, { triageColor: 'rot' } as any);
    await service.queueTriage(7, { dringend: true } as any);

    expect(added).toHaveLength(2);
    expect(added[0].id).not.toBe(added[1].id);
  });

  it.each([7, 99])(
    'persists the authoritative triage acknowledgement only for matching active patient %i before dropping intent',
    async (activePatientId) => {
      const responder = new ResponderStateStore();
      responder.setPatient({ id: activePatientId, transport: true, atmung: true } as any);
      (service as any).responderState = responder;
      const merged = { id: 7, transport: false, atmung: null, blutung: true };
      const item = { ...triage('transport', 7), body: { transport: true } };
      vi.spyOn(service as any, 'items').mockResolvedValue([item]);
      vi.spyOn(service as any, 'realPatientId').mockResolvedValue(7);
      api.updateTriage.mockReturnValue(of(merged));
      let acknowledgedAtDeletion: unknown;
      const remove = vi.spyOn(service as any, 'deleteIfCurrent').mockImplementation(async () => {
        acknowledgedAtDeletion = new ResponderStateStore().patient();
        return true;
      });
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      await service.flush();
      expect(remove).toHaveBeenCalledWith(item);
      expect(acknowledgedAtDeletion).toEqual(
        activePatientId === 7 ? merged : { id: 99, transport: true, atmung: true },
      );
    },
  );

  it('continues with an unrelated item after a permanent failure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const items = [triage('first', 1), triage('second', 2)];
    vi.spyOn(service as any, 'items').mockResolvedValue(items);
    vi.spyOn(service as any, 'realPatientId').mockImplementation((...args: unknown[]) =>
      Promise.resolve(Number(args[0])),
    );
    (service as any).replaceIfCurrent = vi.fn().mockResolvedValue(true);
    const remove = vi.spyOn(service as any, 'deleteIfCurrent').mockResolvedValue(undefined);
    api.updateTriage
      .mockReturnValueOnce(throwError(() => new ApiRequestError(400, {})))
      .mockReturnValueOnce(of({}));

    await service.flush();

    expect(api.updateTriage).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }));
    expect((service as any).replaceIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'first' }),
      expect.objectContaining({
        id: 'first',
        state: 'blocked',
        attemptCount: 1,
        lastError: 'HTTP 400',
      }),
    );
  });

  it('defers only writes that still depend on a provisional patient mapping', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(service as any, 'items').mockResolvedValue([
      triage('dependent', -1),
      triage('ready', 2),
    ]);
    vi.spyOn(service as any, 'realPatientId').mockImplementation((...args: unknown[]) =>
      Promise.resolve(Number(args[0])),
    );
    (service as any).replaceIfCurrent = vi.fn().mockResolvedValue(true);
    const remove = vi.spyOn(service as any, 'deleteIfCurrent').mockResolvedValue(undefined);
    api.updateTriage.mockReturnValue(of({}));

    await service.flush();

    expect(api.updateTriage).toHaveBeenCalledOnce();
    expect(api.updateTriage).toHaveBeenCalledWith(2, expect.anything());
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'ready' }));
    expect((service as any).replaceIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'dependent' }),
      expect.objectContaining({
        id: 'dependent',
        state: 'retrying',
        lastError: 'Patientenzuordnung ausstehend',
      }),
    );
  });

  it('reads pending triage intent in edit order and resolves provisional IDs', async () => {
    vi.spyOn(service as any, 'items').mockResolvedValue([
      {
        ...triage('late-network-failure', -7),
        body: { dringend: true, clientUpdatedAt: '2026-01-01T10:00:00Z' },
      },
      {
        ...triage('early-network-failure', 7),
        body: { transport: true, clientUpdatedAt: '2026-01-01T09:00:00Z' },
      },
      triage('other-patient', 8),
    ]);
    vi.spyOn(service as any, 'realPatientId').mockImplementation((id: any) =>
      Promise.resolve(Math.abs(id)),
    );
    expect(await service.pendingTriage(7)).toEqual([
      { transport: true, clientUpdatedAt: '2026-01-01T09:00:00Z' },
      { dringend: true, clientUpdatedAt: '2026-01-01T10:00:00Z' },
    ]);
  });

  it('pauses protected replay on an authentication failure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(service as any, 'items').mockResolvedValue([triage('auth', 1), triage('later', 2)]);
    vi.spyOn(service as any, 'realPatientId').mockImplementation((...args: unknown[]) =>
      Promise.resolve(Number(args[0])),
    );
    (service as any).replaceIfCurrent = vi.fn().mockResolvedValue(true);
    vi.spyOn(service as any, 'deleteIfCurrent').mockResolvedValue(undefined);
    api.updateTriage.mockReturnValue(throwError(() => new ApiRequestError(401, {})));

    await service.flush();

    expect(api.updateTriage).toHaveBeenCalledOnce();
    expect((service as any).replaceIfCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auth' }),
      expect.objectContaining({ state: 'blocked', errorStatus: 401 }),
    );
  });

  it('marks queue flush time only after a persisted queue deletion', async () => {
    (service as any).withStore = vi.fn().mockResolvedValue(true);

    await (service as any).deleteIfCurrent(triage('done', 1));

    expect(sync.markQueueFlushed).toHaveBeenCalledOnce();
  });
});

function triage(id: string, patientId: number): any {
  return { id, type: 'triage', patientId, body: {}, createdAt: '2026-01-01T00:00:00Z' };
}
