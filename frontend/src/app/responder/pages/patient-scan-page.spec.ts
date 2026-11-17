import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ApiClient, ApiRequestError } from '../../api/api-client';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { GeolocationService } from '../services/geolocation.service';
import { ResponderStateStore } from '../services/responder-state';
import { PatientScanPage } from './patient-scan-page';

describe('PatientScanPage manual intake', () => {
  function setup(error: unknown) {
    const createProvisionalPatient = vi.fn().mockResolvedValue({ id: -1 });
    const flush = vi.fn().mockResolvedValue(undefined);
    const blockedItems = () =>
      error instanceof ApiRequestError ? [{ patientId: -1, lastError: 'Abgelehnt' }] : [];
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: { createManualPatient: () => throwError(() => error) } },
        {
          provide: OfflineQueueService,
          useValue: { createProvisionalPatient, flush, blockedItems },
        },
        { provide: GeolocationService, useValue: { currentPosition: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: ResponderStateStore,
          useValue: { scene: () => ({ id: 4 }), patient: () => ({ id: -1 }), setPatient: vi.fn() },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new PatientScanPage());
    return { page: page as any, createProvisionalPatient };
  }

  it('queues the intake when the network fails although the device reports online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { page, createProvisionalPatient } = setup(new TypeError('Failed to fetch'));

    page.createManual();
    await new Promise((resolve) => setTimeout(resolve));

    expect(createProvisionalPatient).toHaveBeenCalledWith(
      expect.objectContaining({ operationSceneId: 4, clientGeneratedId: expect.any(String) }),
    );
  });

  it('shows a validation error instead of queueing a rejected intake', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { page, createProvisionalPatient } = setup(new ApiRequestError(400, {}));

    page.createManual();
    await new Promise((resolve) => setTimeout(resolve));

    expect(createProvisionalPatient).toHaveBeenCalledOnce();
    expect(page.error()).not.toBe('');
  });

  it.each([7, -7])('persists GPS for patient %i before dispatch or navigation', async (id) => {
    const { page } = setup(new TypeError('unused'));
    vi.spyOn(TestBed.inject(GeolocationService), 'currentPosition').mockResolvedValue({
      lat: 48.2,
      lng: 16.3,
    });
    const queue = TestBed.inject(OfflineQueueService) as any;
    let commit!: () => void;
    queue.queueLocation = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        commit = resolve;
      }),
    );
    const capture = page.captureLocation(id);
    await Promise.resolve();
    expect(queue.flush).not.toHaveBeenCalled();
    expect(queue.queueLocation).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ source: 'gps', clientUpdatedAt: expect.any(String) }),
      expect.any(String),
    );
    commit();
    expect(await capture).toBe(true);
    expect(queue.flush).toHaveBeenCalledWith(true);
  });

  it('reports GPS storage failure instead of silently proceeding', async () => {
    const { page } = setup(new TypeError('unused'));
    vi.spyOn(TestBed.inject(GeolocationService), 'currentPosition').mockResolvedValue({
      lat: 48.2,
      lng: 16.3,
    });
    const queue = TestBed.inject(OfflineQueueService) as any;
    queue.queueLocation = vi.fn().mockRejectedValue(new Error('IndexedDB aborted'));
    expect(await page.captureLocation(7)).toBe(false);
    expect(queue.flush).not.toHaveBeenCalled();
    expect(page.error()).toContain('nicht dauerhaft gespeichert');
  });

  it('waits for durable GPS capture after QR intake and stays on intake if storage fails', async () => {
    const { page } = setup(new TypeError('unused'));
    const api = TestBed.inject(ApiClient) as any;
    api.verifyPatientQrCode = vi.fn().mockReturnValue(of({ patient: { id: 7 } }));
    vi.spyOn(TestBed.inject(GeolocationService), 'currentPosition').mockResolvedValue({
      lat: 48.2,
      lng: 16.3,
    });
    const queue = TestBed.inject(OfflineQueueService) as any;
    const router = TestBed.inject(Router) as any;
    let commit!: () => void;
    queue.queueLocation = vi.fn().mockReturnValueOnce(
      new Promise<void>((resolve) => {
        commit = resolve;
      }),
    );
    page.verifyQr('fixture');
    await vi.waitFor(() => expect(queue.queueLocation).toHaveBeenCalledOnce());
    expect(queue.flush).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    commit();
    await vi.waitFor(() => expect(router.navigateByUrl).toHaveBeenCalledWith('/patient/7'));
    queue.flush.mockClear();
    router.navigateByUrl.mockClear();
    queue.queueLocation.mockRejectedValue(new Error('transaction aborted'));
    page.verifyQr('fixture');
    await vi.waitFor(() => expect(page.error()).toContain('nicht dauerhaft gespeichert'));
    expect(queue.flush).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
