import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { LocalWorkspaceService } from '../../sync/local-workspace.service';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { AuthStore } from '../auth.store';
import { MyAccess } from './my-access';

describe('MyAccess logout protection', () => {
  it('guards the handler as well as the button while local persistence or synchronization is pending', () => {
    const pending = signal(true);
    const identity = {};
    const api = { selfCancel: vi.fn(() => of({})) };
    const clear = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeSession: () => ({ tokenType: 'user' }),
            sessionIdentity: () => identity,
            clear: vi.fn(),
          },
        },
        { provide: OfflineQueueService, useValue: { hasPendingWork: pending } },
        { provide: LocalWorkspaceService, useValue: { clear } },
      ],
    });
    const fixture = TestBed.createComponent(MyAccess);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
    (fixture.componentInstance as any).selfCancel();
    expect(api.selfCancel).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    pending.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
    (fixture.componentInstance as any).selfCancel();
    expect(api.selfCancel).toHaveBeenCalledOnce();
  });
});

describe('MyAccess logout', () => {
  function setup(logout: () => ReturnType<ApiClient['logout']>) {
    const clear = vi.fn();
    const authClear = vi.fn();
    const identity = {};
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: { logout } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: AuthStore,
          useValue: {
            activeSession: () => ({ tokenType: 'user' }),
            sessionIdentity: () => identity,
            clear: authClear,
          },
        },
        { provide: OfflineQueueService, useValue: { hasPendingWork: () => false } },
        { provide: LocalWorkspaceService, useValue: { clear } },
      ],
    });
    const fixture = TestBed.createComponent(MyAccess);
    fixture.detectChanges();
    return { fixture, clear, authClear };
  }

  it('clears the local session after a successful revoke', async () => {
    const { fixture, clear, authClear } = setup(() => of(undefined));
    (fixture.componentInstance as any).logout();
    expect(clear).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    expect(authClear).toHaveBeenCalledOnce();
  });

  it('still clears the local session when the revoke call fails', async () => {
    const { fixture, clear, authClear } = setup(() => throwError(() => new Error('offline')));
    (fixture.componentInstance as any).logout();
    expect(clear).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    expect(authClear).toHaveBeenCalledOnce();
  });
});
