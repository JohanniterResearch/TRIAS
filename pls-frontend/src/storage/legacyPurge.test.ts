import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isLegacyKey, purgeLegacyStorage } from './keys';

// Old PLS (MySQL) state on a device: tokens, a GPS job for patient 5 marked written, and a
// protocol draft for patient 5. Patient 5 on the Ambulanzsystem backend is a different person.
function seedLegacyPlsState() {
  localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'old-pls-token', adminToken: null }, version: 0 }));
  localStorage.setItem(
    'patient-location-storage',
    JSON.stringify({ state: { jobs: { 5: { patientId: 5, status: 'written', coordinates: { lat: 1, lng: 2 }, error: null, updatedAt: '2026-01-01T00:00:00Z' } } }, version: 0 }),
  );
  localStorage.setItem('ambdoku:page1:patient:5', JSON.stringify({ patientId: 5, status: 'draft', formState: {} }));
  localStorage.setItem('Username', 'old-admin');
  localStorage.setItem('unrelated-key', 'keep');
}

describe('legacy PLS state (WP 1.2)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('recognizes exactly the old PLS keys', () => {
    expect(isLegacyKey('auth-storage')).toBe(true);
    expect(isLegacyKey('ambdoku:page1:patient:12')).toBe(true);
    expect(isLegacyKey('pls:ambulanz-v1:auth')).toBe(false);
    expect(isLegacyKey('unrelated-key')).toBe(false);
  });

  it('removes the old keys and nothing else', () => {
    seedLegacyPlsState();
    expect(purgeLegacyStorage().sort()).toEqual(['Username', 'ambdoku:page1:patient:5', 'auth-storage', 'patient-location-storage']);
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
  });

  it('starts with empty stores, makes no write to the new backend, and leaves no old keys', async () => {
    seedLegacyPlsState();
    const updatePatientLocation = vi.fn();
    vi.doMock('../api/endpoints', () => ({ updatePatientLocation }));
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: vi.fn() },
    });

    // Same order as main.tsx: purge first, then the stores load.
    await import('./purgeOnStart');
    const { useAuthStore } = await import('../stores/authStore');
    const { usePatientLocationStore } = await import('../stores/patientLocationStore');
    const { readPage1Draft } = await import('../features/ambulanzprotokoll-page1/page1Storage');

    expect(useAuthStore.getState().session).toBeNull();
    expect(usePatientLocationStore.getState().jobs).toEqual({});
    expect(readPage1Draft(5)).toBeNull();
    expect(updatePatientLocation).not.toHaveBeenCalled();
    for (const key of ['auth-storage', 'patient-location-storage', 'ambdoku:page1:patient:5', 'Username']) {
      expect(localStorage.getItem(key)).toBeNull();
    }

    // The legacy "written" job for patient 5 no longer suppresses a fresh GPS capture.
    void usePatientLocationStore.getState().ensurePatientLocation(5);
    expect(usePatientLocationStore.getState().jobs[5]?.status).toBe('locating');
  });

  it('never reads old keys even if the purge had not run', async () => {
    seedLegacyPlsState();
    const { useAuthStore } = await import('../stores/authStore');
    const { usePatientLocationStore } = await import('../stores/patientLocationStore');
    expect(useAuthStore.getState().session).toBeNull();
    expect(usePatientLocationStore.getState().jobs).toEqual({});
  });
});
