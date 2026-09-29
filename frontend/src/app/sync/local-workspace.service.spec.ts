import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AuthStore } from '../auth/auth.store';
import { ProtokollDraftStore } from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { OfflineQueueService } from './offline-queue.service';
import { LocalWorkspaceService } from './local-workspace.service';

describe('LocalWorkspaceService', () => {
  it('preserves all drafts when queue clearing refuses pending work', async () => {
    const clear = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: OfflineQueueService,
          useValue: { clear: () => Promise.reject(new Error('pending')) },
        },
        { provide: ProtokollDraftStore, useValue: { clear } },
        { provide: ResponderStateStore, useValue: { clear } },
        { provide: TriageDraftStore, useValue: { clear } },
      ],
    });
    await expect(TestBed.inject(LocalWorkspaceService).clear()).rejects.toThrow('pending');
    expect(clear).not.toHaveBeenCalled();
  });

  it('drops synced patient data but keeps drafts with unsent writes when the session expires', async () => {
    const session = signal<any>({ tokenType: 'qr', expired: false });
    const deleteExcept = vi.fn().mockResolvedValue(undefined);
    const responderClear = vi.fn();
    const triageClear = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: OfflineQueueService,
          useValue: {
            whenReady: () => Promise.resolve(),
            pendingPatientIds: () => Promise.resolve(new Set([-3, 7])),
          },
        },
        { provide: ProtokollDraftStore, useValue: { deleteExcept } },
        { provide: ResponderStateStore, useValue: { clear: responderClear } },
        { provide: TriageDraftStore, useValue: { clear: triageClear } },
        { provide: AuthStore, useValue: { activeSession: session } },
      ],
    });
    TestBed.inject(LocalWorkspaceService);
    TestBed.tick();
    expect(deleteExcept).not.toHaveBeenCalled();

    session.set({ tokenType: 'qr', expired: true });
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));

    expect(deleteExcept).toHaveBeenCalledWith(new Set([-3, 7]));
    expect(responderClear).toHaveBeenCalled();
    expect(triageClear).toHaveBeenCalled();
  });
});
