import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePatientTriage } from './usePatientTriage';
import { TRIAGE_COLOR } from '../types/triageColor';
import { signIn } from '../test/session';

const updateTriageColorMock = vi.fn();
const updateRespirationMock = vi.fn();

vi.mock('../api/endpoints', () => ({
  updateTriageColor: (...args: unknown[]) => updateTriageColorMock(...args),
  updateRespiration: (...args: unknown[]) => updateRespirationMock(...args),
}));

describe('usePatientTriage', () => {
  beforeEach(() => {
    signIn('qr', '1');
    updateTriageColorMock.mockReset().mockResolvedValue({ data: {} });
    updateRespirationMock.mockReset().mockResolvedValue({ data: {} });
  });

  it('writes the triage color and reports success', async () => {
    const { result } = renderHook(() => usePatientTriage(24));

    let ok = false;
    await act(async () => {
      ok = await result.current.setTriageColor(TRIAGE_COLOR.GRUEN, { respiration: true });
    });

    expect(ok).toBe(true);
    expect(updateTriageColorMock).toHaveBeenCalledWith(24, { triageColor: 'grün', respiration: true, clientUpdatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) }, { expectedOwner: 'qr:1' });
    expect(result.current.error).toBeNull();
  });

  it('writes respiration', async () => {
    const { result } = renderHook(() => usePatientTriage(24));

    await act(async () => {
      await result.current.setRespiration(false);
    });

    expect(updateRespirationMock).toHaveBeenCalledWith(24, { respiration: false, clientUpdatedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) }, { expectedOwner: 'qr:1' });
  });

  it('writes one clinical flag alone, stamped with the moment of input (WP 3.3, 3.4)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T10:00:00.000Z'));
    updateTriageColorMock.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-10-09T10:05:00.000Z')); // delivered later
      return { data: {} };
    });
    const { result } = renderHook(() => usePatientTriage(24));

    await act(async () => {
      await result.current.setFlag('kontaminiert', true);
    });

    expect(updateTriageColorMock).toHaveBeenCalledWith(24, { kontaminiert: true, clientUpdatedAt: '2026-10-09T10:00:00.000Z' }, { expectedOwner: 'qr:1' });
    vi.useRealTimers();
  });

  it('reports a failed write with the server message instead of success', async () => {
    updateTriageColorMock.mockRejectedValue({ response: { status: 400, data: { status: 'error', message: 'triageColor must be one of rot, gelb, gruen, schwarz.' } } });
    const { result } = renderHook(() => usePatientTriage(24));

    let ok = true;
    await act(async () => {
      ok = await result.current.setTriageColor(TRIAGE_COLOR.ROT);
    });

    expect(ok).toBe(false);
    expect(result.current.error).toBe('triageColor must be one of rot, gelb, gruen, schwarz.');
  });

  it('refuses to write without a patient', async () => {
    const { result } = renderHook(() => usePatientTriage(null));

    let ok = true;
    await act(async () => {
      ok = await result.current.setTriageColor(TRIAGE_COLOR.ROT);
    });

    expect(ok).toBe(false);
    expect(updateTriageColorMock).not.toHaveBeenCalled();
  });
});
