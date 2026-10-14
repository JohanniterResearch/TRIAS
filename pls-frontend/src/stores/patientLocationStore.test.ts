import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientLocationStore } from './patientLocationStore';
import { signIn } from '../test/session';

const updatePatientLocationMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../api/endpoints', () => ({
  updatePatientLocation: (...args: unknown[]) => updatePatientLocationMock(...args),
}));

describe('patientLocationStore', () => {
  let getCurrentPositionMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signIn('qr', '1');
    usePatientLocationStore.getState().clearJobs();
    updatePatientLocationMock.mockReset();
    getCurrentPositionMock = vi.fn();

    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: getCurrentPositionMock,
      },
    });
  });

  afterEach(() => {
    usePatientLocationStore.getState().clearJobs();
    window.localStorage.clear();
  });

  it('starts a single idempotent location job and writes the result', async () => {
    let onSuccess: ((position: GeolocationPosition) => void) | undefined;

    getCurrentPositionMock.mockImplementation((success: (position: GeolocationPosition) => void) => {
      onSuccess = success;
    });

    const firstCall = usePatientLocationStore.getState().ensurePatientLocation(31);
    const secondCall = usePatientLocationStore.getState().ensurePatientLocation(31);

    expect(getCurrentPositionMock).toHaveBeenCalledTimes(1);
    expect(usePatientLocationStore.getState().jobs[31]?.status).toBe('locating');

    onSuccess?.({
      coords: {
        latitude: 48.21,
        longitude: 16.37,
        accuracy: 1,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.parse('2026-10-09T10:00:00.000Z'),
      toJSON: () => ({}),
    });

    await Promise.all([firstCall, secondCall]);

    expect(updatePatientLocationMock).toHaveBeenCalledWith(31, {
      lat: 48.21,
      lng: 16.37,
      accuracyMeters: 1,
      source: 'gps',
      // The fix time, not the delivery time (WP 3.4).
      clientUpdatedAt: '2026-10-09T10:00:00.000Z',
    }, { expectedOwner: 'qr:1' });
    expect(usePatientLocationStore.getState().jobs[31]?.status).toBe('written');
  });
});
