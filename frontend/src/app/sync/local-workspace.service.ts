import { effect, inject, Injectable } from '@angular/core';

import { AuthStore } from '../auth/auth.store';
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
  private readonly auth = inject(AuthStore);

  constructor() {
    // An expired session can only continue after an online login, which reloads everything from
    // the server, so patient data already synced has no reason to stay on the device meanwhile.
    effect(() => {
      if (this.auth.activeSession()?.expired) void this.clearSynced().catch(() => undefined);
    });
  }

  async clear(): Promise<void> {
    await this.offlineQueue.clear();
    await this.protocolDrafts.clear();
    this.responderState.clear();
    this.triageDrafts.clear();
  }

  /** Removes local patient data except unsent writes and the drafts they belong to. */
  async clearSynced(): Promise<void> {
    await this.offlineQueue.whenReady();
    await this.protocolDrafts.deleteExcept(await this.offlineQueue.pendingPatientIds());
    this.responderState.clear();
    this.triageDrafts.clear();
  }
}
