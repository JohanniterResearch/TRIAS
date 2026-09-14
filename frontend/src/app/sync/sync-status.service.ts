import { Injectable, signal } from '@angular/core';

const lastServerContactKey = 'ambulanzsystem.lastServerContact.v1';
const lastQueueFlushKey = 'ambulanzsystem.lastQueueFlush.v1';

@Injectable({ providedIn: 'root' })
export class SyncStatusService {
  readonly online = signal(navigator.onLine);
  readonly lastServerContact = signal<string | null>(localStorage.getItem(lastServerContactKey));
  readonly lastSuccessfulQueueFlush = signal<string | null>(
    localStorage.getItem(lastQueueFlushKey),
  );
  readonly pendingCount = signal(0);
  readonly oldestPendingAt = signal<string | null>(null);
  readonly queueReady = signal(false);
  readonly failedCount = signal(0);
  readonly lastQueueError = signal<string | null>(null);
  readonly validationDegraded = signal(false);

  constructor() {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
  }

  markServerContact(at = new Date()): void {
    const iso = at.toISOString();
    localStorage.setItem(lastServerContactKey, iso);
    this.lastServerContact.set(iso);
  }

  markQueueFlushed(at = new Date()): void {
    const iso = at.toISOString();
    localStorage.setItem(lastQueueFlushKey, iso);
    this.lastSuccessfulQueueFlush.set(iso);
  }

  markValidationDegraded(): void {
    this.validationDegraded.set(true);
  }

  clearValidationDegraded(): void {
    this.validationDegraded.set(false);
  }

  setPending(
    count: number,
    oldestAt: string | null,
    failedCount = 0,
    lastError: string | null = null,
  ): void {
    this.pendingCount.set(count);
    this.oldestPendingAt.set(oldestAt);
    this.queueReady.set(true);
    this.failedCount.set(failedCount);
    this.lastQueueError.set(lastError);
  }
}
