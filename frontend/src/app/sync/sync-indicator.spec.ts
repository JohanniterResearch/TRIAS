import { TestBed } from '@angular/core/testing';

import { SyncIndicator } from './sync-indicator';
import { SyncStatusService } from './sync-status.service';

describe('SyncIndicator last synchronization time', () => {
  it('uses the newer server contact or queue flush timestamp', () => {
    localStorage.clear();
    const sync = TestBed.inject(SyncStatusService);
    const indicator = TestBed.runInInjectionContext(() => new SyncIndicator());

    sync.markQueueFlushed(new Date('2026-01-01T10:00:00Z'));
    sync.markServerContact(new Date('2026-01-01T10:01:00Z'));
    expect((indicator as any).lastSync()).toBe('2026-01-01T10:01:00.000Z');

    sync.markQueueFlushed(new Date('2026-01-01T10:02:00Z'));
    expect((indicator as any).lastSync()).toBe('2026-01-01T10:02:00.000Z');
  });

  it('falls back to whichever timestamp is available', () => {
    localStorage.clear();
    const sync = TestBed.inject(SyncStatusService);
    const indicator = TestBed.runInInjectionContext(() => new SyncIndicator());

    sync.markServerContact(new Date('2026-01-01T10:01:00Z'));
    expect((indicator as any).lastSync()).toBe('2026-01-01T10:01:00.000Z');
  });
});

describe('SyncIndicator connectivity icon', () => {
  it('uses the online icon only when the browser is online and the server is reachable', () => {
    const sync = TestBed.inject(SyncStatusService);
    sync.online.set(true);
    const fixture = TestBed.createComponent(SyncIndicator);
    const element: HTMLElement = fixture.nativeElement;
    fixture.detectChanges();
    expect(element.querySelector('.sync-icon circle')).not.toBeNull();

    sync.markServerUnreachable();
    fixture.detectChanges();
    expect(element.querySelector('.sync-state')?.textContent?.trim()).toBe(
      'Server nicht erreichbar',
    );
    expect(element.querySelector('.sync-icon circle')).toBeNull();

    sync.markServerContact();
    sync.online.set(false);
    fixture.detectChanges();
    expect(element.querySelector('.sync-state')?.textContent?.trim()).toBe(
      'Offline - Daten werden gespeichert',
    );
    expect(element.querySelector('.sync-icon circle')).toBeNull();

    sync.online.set(true);
    fixture.detectChanges();
    expect(element.querySelector('.sync-icon circle')).not.toBeNull();
  });
});
