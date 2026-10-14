import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_INTERVAL_MS, useSceneLive } from './useSceneLive';
import type { SceneRealtimeHandlers } from '../realtime/sceneRealtime';
import type { Patient } from '../api/endpoints';

const getPersons = vi.fn();
const getTeams = vi.fn();
let hub: SceneRealtimeHandlers | undefined;

vi.mock('../api/endpoints', () => ({
  getPersons: (...a: unknown[]) => getPersons(...a),
  getTeams: (...a: unknown[]) => getTeams(...a),
}));
vi.mock('../realtime/sceneRealtime', () => ({
  connectScene: (_scene: number, _token: () => string, handlers: SceneRealtimeHandlers) => {
    hub = handlers;
    return () => undefined;
  },
}));

const patient = (id: number, triagefarbe: Patient['triagefarbe'] = null): Patient => ({ id, operationSceneId: 3, triagefarbe, createdAt: '', updatedAt: '' });

beforeEach(() => {
  vi.useFakeTimers();
  getPersons.mockReset().mockResolvedValue({ data: [patient(1)] });
  getTeams.mockReset().mockResolvedValue({ data: [] });
});
afterEach(() => vi.useRealTimers());

describe('useSceneLive (WP 5.1)', () => {
  it('replaces state with the snapshot and applies upserts', async () => {
    const { result } = renderHook(() => useSceneLive(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      hub!.onSnapshot({ sceneId: 3, patients: [patient(1), patient(2)], teams: [], eventTimestamp: '' });
      hub!.onState('connected');
      hub!.onPatient({ sceneId: 3, patient: patient(2, 'rot'), bodyParts: { kopf_vorne: 1 }, eventTimestamp: '' });
    });

    expect(result.current.patients.map((p) => [p.id, p.triagefarbe])).toEqual([[1, null], [2, 'rot']]);
    expect(result.current.bodyParts[2]).toEqual({ regions: { kopf_vorne: 1 }, receivedAt: expect.any(Number) });
  });

  it('polls every 10 s only while the hub is not connected', async () => {
    renderHook(() => useSceneLive(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getPersons).toHaveBeenCalledTimes(1);

    act(() => hub!.onState('polling'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(getPersons).toHaveBeenCalledTimes(2);

    act(() => {
      hub!.onSnapshot({ sceneId: 3, patients: [patient(1)], teams: [], eventTimestamp: '' });
      hub!.onState('connected');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(getPersons).toHaveBeenCalledTimes(2);
  });

  it('does not let a slower poll overwrite pushed state', async () => {
    let answer: (value: unknown) => void = () => undefined;
    getPersons.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useSceneLive(3));
    act(() => {
      hub!.onSnapshot({ sceneId: 3, patients: [patient(1, 'rot')], teams: [], eventTimestamp: '' });
      hub!.onState('connected');
    });
    await act(async () => {
      answer({ data: [patient(1, null)] });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.patients[0].triagefarbe).toBe('rot');
  });

  it('ignores messages of another scene (security review 3, L3)', async () => {
    const { result } = renderHook(() => useSceneLive(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      hub!.onSnapshot({ sceneId: 9, patients: [patient(5)], teams: [], eventTimestamp: '' });
      hub!.onPatient({ sceneId: 9, patient: patient(6), bodyParts: { kopf_vorne: 1 }, eventTimestamp: '' });
    });
    expect(result.current.patients.map((p) => p.id)).toEqual([1]);
    expect(result.current.bodyParts).toEqual({});
  });

  it('shows nothing of the previous scene when the new one fails to load', async () => {
    const { result, rerender } = renderHook(({ scene }) => useSceneLive(scene), { initialProps: { scene: 3 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.patients).toHaveLength(1);

    getPersons.mockRejectedValueOnce(new Error('403'));
    rerender({ scene: 4 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.patients).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it('a failed refetch after a membership change leaves polling in charge', async () => {
    const { result } = renderHook(() => useSceneLive(3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => {
      hub!.onSnapshot({ sceneId: 3, patients: [patient(1)], teams: [], eventTimestamp: '' });
      hub!.onState('polling');
    });
    getPersons.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      hub!.onPatientList({ sceneId: 3, patientIds: [1, 2], eventTimestamp: '' });
      await vi.advanceTimersByTimeAsync(0);
    });
    getPersons.mockResolvedValue({ data: [patient(1), patient(2)] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    // The poll result is applied (not discarded as if the hub were live).
    expect(result.current.patients.map((p) => p.id)).toEqual([1, 2]);
  });
});
