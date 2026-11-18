import { Component, inject } from '@angular/core';

import { formatTime } from '../shared/date-time-format';
import { FieldConflicts } from './field-conflicts';
import { SyncStatusService } from './sync-status.service';

@Component({
  selector: 'app-sync-indicator',
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
          <span class="sync-time">Queue-Sync {{ formatTime(lastSync) }}</span>
        }
        @if (sync.lastServerContact(); as lastContact) {
          <span class="sync-time">Serverkontakt {{ formatTime(lastContact) }}</span>
        }
      </span>
      @if (sync.failedCount() || conflicts.notices().length) {
        <div class="form-error" role="alert" aria-live="assertive">
          @if (sync.failedCount()) {
            <span>{{ sync.failedCount() }} Sync-Fehler · {{ sync.lastQueueError() }}</span>
          }
          @for (notice of conflicts.notices(); track notice.key) {
            <div>
              Patient {{ notice.patientId }}: {{ notice.message }}
              <button type="button" (click)="conflicts.dismiss(notice.key)">Gelesen</button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class SyncIndicator {
  protected readonly conflicts = inject(FieldConflicts);
  protected readonly sync = inject(SyncStatusService);
  protected readonly formatTime = formatTime;

  protected isOld(): boolean {
    const oldest = this.sync.oldestPendingAt();
    return oldest ? Date.now() - Date.parse(oldest) > 12 * 60 * 60 * 1000 : false;
  }
}
