import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { SyncStatusService } from './sync-status.service';

@Component({
  selector: 'app-sync-indicator',
  imports: [DatePipe],
  template: `
    <div
      class="sync-indicator"
      [class.offline]="!sync.online()"
      [attr.data-sync-state]="
        sync.validationDegraded()
          ? 'validation-degraded'
          : sync.failedCount()
            ? 'error'
            : sync.pendingCount()
              ? 'pending'
              : 'synced'
      "
    >
      <span role="status" aria-live="polite">
        <span class="sync-dot" aria-hidden="true"></span>
        <span>{{ sync.online() ? 'Online' : 'Offline' }}</span>
        @if (sync.validationDegraded()) {
          <span class="form-error"
            >Anmeldung kann nicht bestätigt werden · erneuter Versuch folgt</span
          >
        }
        @if (sync.pendingCount()) {
          <span>{{ sync.pendingCount() }} offen</span>
        }
        @if (isOld()) {
          <span class="form-error">älter als 12 h</span>
        }
        @if (sync.lastSuccessfulQueueFlush(); as lastSync) {
          <span class="sync-time">Queue-Sync {{ lastSync | date: 'shortTime' }}</span>
        }
        @if (sync.lastServerContact(); as lastContact) {
          <span class="sync-time">Serverkontakt {{ lastContact | date: 'shortTime' }}</span>
        }
      </span>
      @if (sync.failedCount()) {
        <span class="form-error" role="alert" aria-live="assertive"
          >{{ sync.failedCount() }} Sync-Fehler · {{ sync.lastQueueError() }}</span
        >
      }
    </div>
  `,
})
export class SyncIndicator {
  protected readonly sync = inject(SyncStatusService);

  protected isOld(): boolean {
    const oldest = this.sync.oldestPendingAt();
    return oldest ? Date.now() - Date.parse(oldest) > 12 * 60 * 60 * 1000 : false;
  }
}
