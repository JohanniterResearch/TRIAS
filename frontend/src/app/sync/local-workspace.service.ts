import { inject, Injectable } from '@angular/core';

import { ProtokollDraftStore } from '../protokoll/services/protokoll-draft-store';
import { ResponderStateStore } from '../responder/services/responder-state';
import { TriageDraftStore } from '../responder/services/triage-draft-store';
import { OfflineQueueService } from './offline-queue.service';

@Injectable({ providedIn: 'root' })
export class LocalWorkspaceService {
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly responderState = inject(ResponderStateStore);
  private readonly triageDrafts = inject(TriageDraftStore);
  private readonly protocolDrafts = inject(ProtokollDraftStore);

  async clear(): Promise<void> {
    await this.offlineQueue.clear();
    await this.protocolDrafts.clear();
    this.responderState.clear();
    this.triageDrafts.clear();
  }
}
