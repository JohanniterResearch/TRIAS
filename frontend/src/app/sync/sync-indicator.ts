import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';

import { formatDateTime } from '../shared/date-time-format';
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
<<<<<<< HEAD
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
=======
      <div class="sync-status" role="status" aria-live="polite">
        <svg class="sync-icon" viewBox="0 0 32 32" aria-hidden="true">
          @if (sync.online()) {
            <path d="M5 12a17 17 0 0 1 22 0M9 17a11 11 0 0 1 14 0m-10 5a5 5 0 0 1 6 0"></path>
            <circle cx="16" cy="26" r="1"></circle>
          } @else {
            <path d="M5 12a17 17 0 0 1 17-2M9 17a11 11 0 0 1 8-2"></path>
            <path d="m5 5 22 22"></path>
          }
        </svg>
        <span class="sync-copy">
          <strong class="sync-state">
            {{ sync.online() ? 'Online' : 'Offline – Daten werden gespeichert' }}
          </strong>
          @if (sync.pendingCount() > 0) {
            <span class="sync-pending">
              {{ sync.pendingCount() }}
              {{ sync.pendingCount() === 1 ? 'Änderung' : 'Änderungen' }} ausstehend
            </span>
          }
        </span>
      </div>
      @if (sync.validationDegraded() || isOld()) {
        <div class="sync-notices" role="status" aria-live="polite">
          @if (sync.validationDegraded()) {
            <span class="form-error"
              >Anmeldung kann nicht bestätigt werden · erneuter Versuch folgt</span
            >
          }
          @if (isOld()) {
            <span class="form-error">älter als 12 h</span>
          }
        </div>
      }
      <span class="sync-time">
        Zuletzt synchronisiert:
        @if (lastSync(); as lastSync) {
          {{ formatDateTime(lastSync) }}
        } @else {
          noch keine
>>>>>>> 53bdb00 (Replace home link list with uniform tile menu:)
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
<<<<<<< HEAD
=======
  protected readonly formatDateTime = formatDateTime;

  protected lastSync(): string | null {
    return this.sync.lastSuccessfulQueueFlush() ?? this.sync.lastServerContact();
  }
>>>>>>> 53bdb00 (Replace home link list with uniform tile menu:)

  protected isOld(): boolean {
    const oldest = this.sync.oldestPendingAt();
    return oldest ? Date.now() - Date.parse(oldest) > 12 * 60 * 60 * 1000 : false;
  }
}
