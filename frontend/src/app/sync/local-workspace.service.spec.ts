import { TestBed } from '@angular/core/testing';

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
});
