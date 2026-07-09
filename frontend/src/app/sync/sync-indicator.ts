import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { SyncStatusService } from './sync-status.service';

@Component({
  selector: 'app-sync-indicator',
  imports: [DatePipe],
  template: `
    <div class="sync-indicator" [class.offline]="!sync.online()">
      <span class="sync-dot" aria-hidden="true"></span>
      <span>{{ sync.online() ? 'Online' : 'Offline' }}</span>
      @if (sync.lastSuccessfulSync(); as lastSync) {
        <span class="sync-time">Sync {{ lastSync | date: 'shortTime' }}</span>
      }
    </div>
  `,
})
export class SyncIndicator {
  protected readonly sync = inject(SyncStatusService);
}
