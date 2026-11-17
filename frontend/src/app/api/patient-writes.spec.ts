import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../auth/auth.store';
import { SyncStatusService } from '../sync/sync-status.service';
import { PatientWriteJournal } from '../sync/patient-write-journal';
import { ApiClient } from './api-client';

describe('Durable patient write orders', () => {
  let api: ApiClient;
  let saved: any[];
  let journal: any;
  const auth = { activeSession: () => null, bearerToken: () => null };
  beforeEach(() => {
    saved = [];
    journal = {
      put: vi.fn(async (item: any) => {
        saved = [...saved.filter((x) => x.writeId !== item.writeId), structuredClone(item)];
      }),
      remove: vi.fn(async (item: any) => {
        saved = saved.filter((x) => x.writeId !== item.writeId);
      }),
      pending: vi.fn(async (owner: string) => saved.filter((x) => x.owner === owner)),
    };
    TestBed.configureTestingModule({
      providers: [
        ApiClient,
        { provide: AuthStore, useValue: auth },
        { provide: PatientWriteJournal, useValue: journal },
        { provide: SyncStatusService, useValue: { markServerContact: vi.fn() } },
      ],
    });
    api = TestBed.inject(ApiClient);
  });
  it('persists before sending and reuses one key and frozen contents after a lost response', async () => {
    const body = { name: 'initial', correctionReason: 'test' };
    const put = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce({ data: { name: 'initial' }, response: new Response('{}') });
    (api as any).client.PUT = put;
    let finish!: () => void;
    journal.put.mockImplementationOnce((item: any) => {
      saved.push(structuredClone(item));
      return new Promise<void>((resolve) => (finish = resolve));
    });
    const result = firstValueFrom(api.updateAdminPatient('reference', body));
    expect(put).not.toHaveBeenCalled();
    body.name = 'later UI edit';
    finish();
    await result;
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]).toEqual(put.mock.calls[0]);
    expect(put.mock.calls[0][1].body.name).toBe('initial');
    expect(put.mock.calls[0][1].params.header['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('gives identical independent user actions distinct UUIDs', async () => {
    const post = vi.fn().mockResolvedValue({ data: {}, response: new Response('{}') });
    (api as any).client.POST = post;
    await firstValueFrom(api.assignAdminPatientQrCode('reference', { source: 'new' }));
    await firstValueFrom(api.assignAdminPatientQrCode('reference', { source: 'new' }));
    expect(post.mock.calls[0][1].params.header['Idempotency-Key']).not.toBe(
      post.mock.calls[1][1].params.header['Idempotency-Key'],
    );
  });
  it('resumes a previously persisted order with its original UUID on a new client instance', async () => {
    const intent = {
      writeId: crypto.randomUUID(),
      kind: 'qr-reassign',
      target: 7,
      body: { qr_code: 'original' },
      owner: 'user:tester',
    };
    saved.push(structuredClone(intent));
    const session = vi
      .spyOn(auth, 'activeSession')
      .mockReturnValue({ tokenType: 'user', username: 'tester', token: 'test-token' } as any);
    const reloaded = TestBed.runInInjectionContext(() => new ApiClient());
    const post = vi.fn().mockResolvedValue({ data: { id: 7 }, response: new Response('{}') });
    (reloaded as any).client.POST = post;
    await (reloaded as any).replayPatientWrites();
    expect(post).toHaveBeenCalledWith('/api/persons/{id}/reassign-qr-code', {
      body: intent.body,
      params: { path: { id: 7 }, header: { 'Idempotency-Key': intent.writeId } },
    });
    expect(saved).toEqual([]);
    session.mockRestore();
  });
});
