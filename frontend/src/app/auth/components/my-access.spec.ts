import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { LocalWorkspaceService } from '../../sync/local-workspace.service';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { AuthStore } from '../auth.store';
import { MyAccess } from './my-access';

describe('MyAccess logout protection', () => {
  it('guards the handler as well as the button while local persistence or synchronization is pending', () => {
    const pending = signal(true);
    const api = { selfCancel: vi.fn(() => of({})) };
    const clear = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: AuthStore,
          useValue: { activeSession: () => ({ tokenType: 'user' }), clear: vi.fn() },
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
