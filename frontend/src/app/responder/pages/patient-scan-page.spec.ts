import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { throwError } from 'rxjs';

import { ApiClient, ApiRequestError } from '../../api/api-client';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { GeolocationService } from '../services/geolocation.service';
import { ResponderStateStore } from '../services/responder-state';
import { PatientScanPage } from './patient-scan-page';

describe('PatientScanPage manual intake', () => {
  function setup(error: unknown) {
    const createProvisionalPatient = vi.fn().mockResolvedValue({ id: -1 });
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: { createManualPatient: () => throwError(() => error) } },
        { provide: OfflineQueueService, useValue: { createProvisionalPatient } },
        { provide: GeolocationService, useValue: { currentPosition: () => Promise.resolve(null) } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: ResponderStateStore,
          useValue: { scene: () => ({ id: 4 }), setPatient: vi.fn() },
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

    expect(createProvisionalPatient).not.toHaveBeenCalled();
    expect(page.error()).not.toBe('');
  });
});
