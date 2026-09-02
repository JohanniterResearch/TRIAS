import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { ProtokollDraftStore } from '../services/protokoll-draft-store';
import { AmbulanzprotokollPage } from './ambulanzprotokoll-page';

describe('AmbulanzprotokollPage route reuse', () => {
  it('resets and loads the new patient when only the route parameter changes', async () => {
    history.replaceState({}, '');
    const params = new BehaviorSubject(convertToParamMap({ patientId: '1' }));
    const records = new Map([
      [1, new Subject<any>()],
      [2, new Subject<any>()],
    ]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ patientId: '1' }) },
            paramMap: params,
          },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: ApiClient,
          useValue: {
            getProtokollPage1: (id: number) => records.get(id)!,
            saveProtokollPage1: vi.fn(),
          },
        },
        {
          provide: ProtokollDraftStore,
          useValue: { get: () => Promise.resolve(null), put: vi.fn() },
        },
        {
          provide: OfflineQueueService,
          useValue: { queueProtocol: vi.fn(), whenReady: () => Promise.resolve() },
        },
        { provide: ResponderStateStore, useValue: { patient: () => null, scene: () => null } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new AmbulanzprotokollPage());
    await tick();

    params.next(convertToParamMap({ patientId: '2' }));
    await tick();
    records.get(2)!.next(record('B'));
    records.get(1)!.next(record('A'));

    expect((page as any).patientId()).toBe(2);
    expect((page as any).form().patient.vorname).toBe('B');
  });

  it('displays warnings returned only by the protocol PUT response', async () => {
    const params = new BehaviorSubject(convertToParamMap({ patientId: '1' }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: ApiClient,
          useValue: {
            getProtokollPage1: () => new Subject<any>(),
            saveProtokollPage1: () => of({ ...record('A'), warnings: ['Server-only warning.'] }),
          },
        },
        {
          provide: ProtokollDraftStore,
          useValue: { get: () => Promise.resolve(null), put: () => Promise.resolve() },
        },
        {
          provide: OfflineQueueService,
          useValue: { queueProtocol: vi.fn(), whenReady: () => Promise.resolve() },
        },
        { provide: ResponderStateStore, useValue: { patient: () => null, scene: () => null } },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new AmbulanzprotokollPage());
    await tick();

    (page as any).save('finalized');

    expect((page as any).warnings()).toContain('Server-only warning.');
  });
});

function record(name: string): any {
  return {
    status: 'draft',
    finalizedAt: null,
    updatedAt: '2026-01-01T10:00:00Z',
    formState: { patient: { vorname: name } },
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}
