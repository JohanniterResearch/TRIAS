import { TestBed } from '@angular/core/testing';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';

import { AuthStore } from '../../auth/auth.store';
import { SceneRealtimeEvent, SceneRealtimeService } from './scene-realtime.service';

describe('SceneRealtimeService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        SceneRealtimeService,
        { provide: AuthStore, useValue: { bearerToken: () => 'token' } },
      ],
    });
  });

  it('never lets stale connection A join its scene through connection B', async () => {
    const a = new FakeConnection();
    const b = new FakeConnection();
    vi.spyOn(HubConnectionBuilder.prototype, 'build')
      .mockReturnValueOnce(a as any)
      .mockReturnValueOnce(b as any);
    const service = TestBed.inject(SceneRealtimeService);

    service.connect(1).subscribe();
    service.connect(2).subscribe();
    b.resolveStart();
    await tick();
    a.resolveStart();
    await tick();

    expect(b.invoke).toHaveBeenCalledWith('JoinScene', 2);
    expect(b.invoke).not.toHaveBeenCalledWith('JoinScene', 1);
  });

  it('emits authoritative patient lists and ignores older entity updates', async () => {
    const connection = new FakeConnection();
    vi.spyOn(HubConnectionBuilder.prototype, 'build').mockReturnValue(connection as any);
    const events: SceneRealtimeEvent[] = [];
    TestBed.inject(SceneRealtimeService)
      .connect(4)
      .subscribe((event) => events.push(event));
    connection.resolveStart();
    await tick();

    connection.emit('PatientUpdated', patientEvent('2026-01-01T10:02:00Z', 'new'));
    connection.emit('PatientUpdated', patientEvent('2026-01-01T10:01:00Z', 'old'));
    connection.emit('SceneSnapshot', {
      sceneId: 4,
      patients: [{ id: 9, name: 'older snapshot' }],
      teams: [],
      eventTimestamp: '2026-01-01T10:01:30Z',
    });
    connection.emit('ScenePatientList', {
      sceneId: 4,
      patientIds: [9],
      eventTimestamp: '2026-01-01T10:03:00Z',
    });

    expect(events.filter((event) => event.type === 'patient')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'patient-list', payload: { patientIds: [9] } });
  });

  it('rejects an older membership list and preserves sub-millisecond event order', async () => {
    const connection = new FakeConnection();
    vi.spyOn(HubConnectionBuilder.prototype, 'build').mockReturnValue(connection as any);
    const events: SceneRealtimeEvent[] = [];
    TestBed.inject(SceneRealtimeService)
      .connect(4)
      .subscribe((event) => events.push(event));
    connection.resolveStart();
    await tick();

    connection.emit('SceneSnapshot', {
      sceneId: 4,
      patients: [{ id: 9, name: 'snapshot' }],
      teams: [],
      eventTimestamp: '2026-01-01T10:00:00.0000002Z',
    });
    connection.emit('ScenePatientList', {
      sceneId: 4,
      patientIds: [],
      eventTimestamp: '2026-01-01T10:00:00.0000001Z',
    });
    connection.emit('PatientUpdated', patientEvent('2026-01-01T10:00:00.0000004Z', 'new'));
    connection.emit('PatientUpdated', patientEvent('2026-01-01T10:00:00.0000003Z', 'old'));

    expect(events.filter((event) => event.type === 'patient-list')).toHaveLength(0);
    expect(events.filter((event) => event.type === 'patient')).toHaveLength(1);
    expect(events.find((event) => event.type === 'patient')).toMatchObject({
      payload: { patient: { name: 'new' } },
    });
  });
});

class FakeConnection {
  state = HubConnectionState.Connected;
  private readonly handlers = new Map<string, (payload: any) => void>();
  private reconnectHandler: (() => void) | null = null;
  private startResolver!: () => void;
  readonly invoke = vi.fn(() => Promise.resolve());
  readonly stop = vi.fn(() => Promise.resolve());
  readonly start = vi.fn(() => new Promise<void>((resolve) => (this.startResolver = resolve)));
  on = vi.fn((name: string, handler: (payload: any) => void) => this.handlers.set(name, handler));
  onreconnected = vi.fn((handler: () => void) => (this.reconnectHandler = handler));

  resolveStart(): void {
    this.startResolver();
  }
  emit(name: string, payload: any): void {
    this.handlers.get(name)?.(payload);
  }
}

function patientEvent(eventTimestamp: string, name: string): any {
  return { sceneId: 4, eventTimestamp, patient: { id: 9, name } };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}
