import { Injectable, signal } from '@angular/core';

const lastSyncKey = 'ambulanzsystem.lastSyncAt.v1';

@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly online = signal(navigator.onLine);
  readonly lastSuccessfulSync = signal<string | null>(localStorage.getItem(lastSyncKey));
  readonly pendingCount = signal(0);
  readonly oldestPendingAt = signal<string | null>(null);

  constructor() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  markSynced(at = new Date()): void {
    const iso = at.toISOString();
    localStorage.setItem(lastSyncKey, iso);
    this.lastSuccessfulSync.set(iso);
  }

  setPending(count: number, oldestAt: string | null): void {
    this.pendingCount.set(count);
    this.oldestPendingAt.set(oldestAt);
  }
}
