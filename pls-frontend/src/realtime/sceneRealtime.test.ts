import { describe, expect, it, vi } from 'vitest';
import type { HubConnection } from '@microsoft/signalr';
import { connectScene, timestampValue, type SceneRealtimeHandlers } from './sceneRealtime';

type Listener = (payload: never) => void;

function fakeConnection() {
  const listeners = new Map<string, Listener>();
  const lifecycle: Record<string, () => void> = {};
  const connection = {
    state: 'Connected',
    on: (name: string, listener: Listener) => listeners.set(name, listener),
    onreconnecting: (fn: () => void) => (lifecycle.reconnecting = fn),
    onreconnected: (fn: () => void) => (lifecycle.reconnected = fn),
    onclose: (fn: () => void) => (lifecycle.close = fn),
    start: vi.fn().mockResolvedValue(undefined),
    invoke: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  const emit = (name: string, payload: unknown) => listeners.get(name)!(payload as never);
  return { connection: connection as unknown as HubConnection & typeof connection, emit, lifecycle };
}

function handlers(): SceneRealtimeHandlers & Record<string, ReturnType<typeof vi.fn>> {
  return { onSnapshot: vi.fn(), onPatient: vi.fn(), onTeam: vi.fn(), onPatientList: vi.fn(), onState: vi.fn() };
}

const patient = (id: number) => ({ id, operationSceneId: 3, createdAt: '', updatedAt: '' });

describe('scene realtime (WP 5.1)', () => {
  it('joins the scene on connect and on every reconnect', async () => {
    const { connection, lifecycle } = fakeConnection();
    const h = handlers();
    connectScene(3, () => 'token', h, () => connection);
    await vi.waitFor(() => expect(h.onState).toHaveBeenLastCalledWith('connected'));
    expect(connection.invoke).toHaveBeenCalledWith('JoinScene', 3);

    lifecycle.reconnecting();
    expect(h.onState).toHaveBeenLastCalledWith('polling');
    lifecycle.reconnected();
    await vi.waitFor(() => expect(h.onState).toHaveBeenLastCalledWith('connected'));
    expect(connection.invoke).toHaveBeenCalledTimes(2);
  });

  it('ignores updates older than what was applied for the same patient', async () => {
    const { connection, emit } = fakeConnection();
    const h = handlers();
    connectScene(3, () => 'token', h, () => connection);
    emit('SceneSnapshot', { sceneId: 3, patients: [patient(1)], teams: [], eventTimestamp: '2026-10-09T10:00:00.0000001Z' });
    emit('PatientUpdated', { sceneId: 3, patient: patient(1), eventTimestamp: '2026-10-09T10:00:00Z' }); // older
    emit('PatientUpdated', { sceneId: 3, patient: patient(1), eventTimestamp: '2026-10-09T10:00:01Z' });
    emit('PatientUpdated', { sceneId: 3, patient: patient(1), eventTimestamp: '2026-10-09T10:00:01Z' }); // duplicate

    expect(h.onSnapshot).toHaveBeenCalledTimes(1);
    expect(h.onPatient).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling and retries when the first start fails', async () => {
    vi.useFakeTimers();
    const { connection } = fakeConnection();
    connection.start.mockRejectedValueOnce(new Error('blocked'));
    const h = handlers();
    connectScene(3, () => 'token', h, () => connection);
    await vi.waitFor(() => expect(h.onState).toHaveBeenLastCalledWith('polling'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connection.start).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('stops delivering after stop() and leaves the scene', async () => {
    const { connection, emit } = fakeConnection();
    const h = handlers();
    const stop = connectScene(3, () => 'token', h, () => connection);
    await vi.waitFor(() => expect(h.onState).toHaveBeenLastCalledWith('connected'));
    stop();
    emit('PatientUpdated', { sceneId: 3, patient: patient(1), eventTimestamp: '2026-10-09T10:00:05Z' });

    expect(h.onPatient).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(connection.invoke).toHaveBeenCalledWith('LeaveScene', 3));
  });

  it('orders server timestamps with sub-millisecond precision', () => {
    expect(timestampValue('2026-10-09T10:00:00.0000002Z')! > timestampValue('2026-10-09T10:00:00.0000001Z')!).toBe(true);
  });
});
