import { TestBed } from '@angular/core/testing';

import { SyncStatusService } from './sync-status.service';

describe('SyncStatusService timestamps', () => {
  it('keeps server contact separate from a successful queue flush', () => {
    localStorage.clear();
    const sync = TestBed.inject(SyncStatusService);
    sync.markServerContact(new Date('2026-01-01T10:00:00Z'));

    expect(sync.lastServerContact()).toBe('2026-01-01T10:00:00.000Z');
    expect(sync.lastSuccessfulQueueFlush()).toBeNull();

    sync.markQueueFlushed(new Date('2026-01-01T10:01:00Z'));
    expect(sync.lastSuccessfulQueueFlush()).toBe('2026-01-01T10:01:00.000Z');
  });

  it('exposes retained queue failures', () => {
    localStorage.clear();
    const sync = TestBed.inject(SyncStatusService);

    sync.setPending(2, '2026-01-01T10:00:00Z', 1, 'HTTP 400');

    expect(sync.failedCount()).toBe(1);
    expect(sync.lastQueueError()).toBe('HTTP 400');
  });

  it('tracks server reachability and offline events', () => {
    localStorage.clear();
    const sync = TestBed.inject(SyncStatusService);

    expect(sync.serverReachable()).toBe(true);

    sync.markServerUnreachable();
    expect(sync.serverReachable()).toBe(false);

    sync.markServerContact(new Date('2026-01-01T12:00:00Z'));
    expect(sync.serverReachable()).toBe(true);

    window.dispatchEvent(new Event('offline'));
    expect(sync.online()).toBe(false);
    expect(sync.serverReachable()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(sync.online()).toBe(true);
  });
});
