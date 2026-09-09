import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { SyncStatusService } from '../../sync/sync-status.service';
import { ResponderStateStore } from '../services/responder-state';
import { TriageDraftStore } from '../services/triage-draft-store';
import { TriagePage } from './triage-page';

describe('triage flag edits', () => {
  const patient = signal<any>(null);
  const api = { updateTriage: vi.fn() };
  const queue = { pendingTriage: vi.fn(), queueTriage: vi.fn() };

  beforeEach(() => {
    localStorage.clear();
    history.replaceState({}, '');
    vi.clearAllMocks();
    patient.set({
      id: 7,
      atmung: true,
      blutung: true,
      radialispuls: null,
      transport: false,
      dringend: null,
      kontaminiert: false,
    });
    queue.pendingTriage.mockResolvedValue([]);
    queue.queueTriage.mockResolvedValue(undefined);
    api.updateTriage.mockImplementation((_id, body) => of({ ...patient(), ...body }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: Router, useValue: {} },
        {
          provide: ResponderStateStore,
          useValue: { patient, setPatient: (value: any) => patient.set(value) },
        },
        { provide: OfflineQueueService, useValue: queue },
      ],
    });
  });

  async function page(): Promise<any> {
    const instance = TestBed.runInInjectionContext(() => new TriagePage());
    TestBed.tick();
    await Promise.resolve();
    return instance;
  }

  it('initializes server true and unknown flags and ignores acknowledged stale drafts', async () => {
    TestBed.inject(TriageDraftStore).merge(7, {
      respiration: false,
      blutung: false,
      radialispuls: false,
    });
    const instance = await page();
    expect(instance.flagsForm.getRawValue()).toEqual({
      respiration: true,
      blutung: true,
      radialispuls: null,
      transport: false,
      dringend: null,
      kontaminiert: false,
    });
  });

  it('submits only the changed checkbox and its edit timestamp', async () => {
    const instance = await page();
    instance.flagsForm.controls.transport.setValue(true);
    instance.saveFlags('transport');
    expect(api.updateTriage).toHaveBeenCalledWith(7, {
      transport: true,
      clientUpdatedAt: expect.any(String),
    });
  });

  it('overlays only pending writes in order on current patient data', async () => {
    queue.pendingTriage.mockResolvedValue([
      { respiration: false, transport: true },
      { respiration: true },
    ]);
    const instance = await page();
    expect(instance.flagsForm.getRawValue()).toMatchObject({
      respiration: true,
      transport: true,
      blutung: true,
      radialispuls: null,
    });
    expect(queue.pendingTriage).toHaveBeenCalledWith(7);
  });

  it('does not restore a slow pending-intent read over a checkbox just edited', async () => {
    let complete!: (value: object[]) => void;
    queue.pendingTriage.mockReturnValue(new Promise((resolve) => (complete = resolve)));
    const instance = await page();
    api.updateTriage.mockReturnValue(throwError(() => new TypeError('offline')));
    instance.flagsForm.controls.transport.setValue(true);
    instance.saveFlags('transport');
    complete([{ transport: false }]);
    await Promise.resolve();
    expect(instance.flagsForm.controls.transport.value).toBe(true);
  });

  it('removes acknowledged intent from the open form after the authoritative conflict response is cached', async () => {
    const sync = TestBed.inject(SyncStatusService);
    const acknowledgedAt = new Date('2026-09-08T00:00:00Z');
    sync.setPending(1, acknowledgedAt.toISOString());
    sync.markQueueFlushed(acknowledgedAt);
    queue.pendingTriage.mockResolvedValue([{ transport: true }]);
    const instance = await page();
    expect(instance.flagsForm.controls.transport.value).toBe(true);
    patient.set({ ...patient(), transport: false });
    TestBed.tick();
    await Promise.resolve();
    expect(instance.flagsForm.controls.transport.value).toBe(true);
    queue.pendingTriage.mockResolvedValue([]);
    sync.markQueueFlushed(acknowledgedAt);
    sync.setPending(0, null);
    TestBed.tick();
    await Promise.resolve();
    expect(instance.flagsForm.controls.transport.value).toBe(false);
  });

  it('preserves another device updates while a local checkbox is queued offline', async () => {
    const instance = await page();
    api.updateTriage.mockReturnValue(throwError(() => new TypeError('offline')));
    instance.flagsForm.controls.transport.setValue(true);
    instance.saveFlags('transport');
    expect(queue.queueTriage).toHaveBeenCalledWith(7, {
      transport: true,
      clientUpdatedAt: expect.any(String),
    });
    queue.pendingTriage.mockResolvedValue([{ transport: true }]);
    patient.set({ ...patient(), atmung: false, blutung: null });
    TestBed.tick();
    await Promise.resolve();
    expect(instance.flagsForm.getRawValue()).toMatchObject({
      respiration: false,
      blutung: null,
      transport: true,
    });
  });
});
