import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import type { Schemas } from '../api/endpoints';

// SignalR client for /hubs/scene (parity plan WP 5.1, contract/schemas/realtime-messages.md).
// Framework-free port of the Ambulanzsystem SceneRealtimeService: callbacks instead of RxJS, the
// same reconnect and ordering rules. Best-effort refresh: the API stays the source of truth.

type Patient = Schemas['Patient'];
type Team = Schemas['Team'];

export interface SceneSnapshot {
  sceneId: number;
  patients: Patient[];
  teams: Team[];
  eventTimestamp: string;
}

export interface PatientUpdated {
  sceneId: number;
  created?: boolean;
  patient: Patient;
  bodyParts?: Record<string, number>;
  protokollStatus?: string;
  eventTimestamp: string;
}

export interface TeamUpdated {
  sceneId: number;
  team: Team;
  eventTimestamp: string;
}

export interface ScenePatientList {
  sceneId: number;
  patientIds: number[];
  eventTimestamp: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'polling';

export interface SceneRealtimeHandlers {
  onSnapshot(snapshot: SceneSnapshot): void;
  onPatient(update: PatientUpdated): void;
  onTeam(update: TeamUpdated): void;
  onPatientList(list: ScenePatientList): void;
  onState(state: ConnectionState): void;
}

const MAX_RETRY_DELAY_MS = 30_000;

/** Nanoseconds since the epoch; the server sends up to 7 fractional digits. */
export function timestampValue(timestamp: string): bigint | null {
  const utc = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(timestamp);
  if (utc) {
    const milliseconds = Date.parse(`${utc[1]}Z`);
    if (!Number.isFinite(milliseconds)) return null;
    const fraction = (utc[2] ?? '').slice(0, 9).padEnd(9, '0');
    return BigInt(milliseconds) * 1_000_000n + BigInt(fraction || '0');
  }
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1_000_000n : null;
}

/**
 * Connects to one scene. Every (re)connect joins the scene, which makes the server send a fresh
 * snapshot; messages older than what was applied for an entity are ignored. Returns `stop`.
 */
export function connectScene(
  sceneId: number,
  accessToken: () => string,
  handlers: SceneRealtimeHandlers,
  buildConnection: (token: () => string) => HubConnection = defaultConnection,
): () => void {
  const connection = buildConnection(accessToken);
  const timestamps = new Map<string, bigint>();
  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const accept = (key: string, timestamp: string) => {
    const value = timestampValue(timestamp);
    if (value === null || value <= (timestamps.get(key) ?? -1n)) return false;
    timestamps.set(key, value);
    return true;
  };
  const record = (key: string, timestamp: string) => {
    const value = timestampValue(timestamp);
    if (value !== null) timestamps.set(key, value);
  };
  const recordLatest = (key: string, timestamp: string) => {
    const value = timestampValue(timestamp);
    if (value !== null && value > (timestamps.get(key) ?? -1n)) timestamps.set(key, value);
  };
  const acceptMembership = (timestamp: string) => {
    const value = timestampValue(timestamp);
    if (value === null) return false;
    if (value <= (timestamps.get('scene') ?? -1n) || value <= (timestamps.get('patient-list') ?? -1n)) return false;
    timestamps.set('patient-list', value);
    return true;
  };

  connection.on('SceneSnapshot', (payload: SceneSnapshot) => {
    if (!active || !accept('scene', payload.eventTimestamp)) return;
    for (const patient of payload.patients) record(`patient:${patient.id}`, payload.eventTimestamp);
    for (const team of payload.teams) record(`team:${team.id}`, payload.eventTimestamp);
    handlers.onSnapshot(payload);
  });
  connection.on('PatientUpdated', (payload: PatientUpdated) => {
    if (!active || !accept(`patient:${payload.patient.id}`, payload.eventTimestamp)) return;
    recordLatest('scene', payload.eventTimestamp);
    handlers.onPatient(payload);
  });
  connection.on('TeamUpdated', (payload: TeamUpdated) => {
    if (!active || !accept(`team:${payload.team.id}`, payload.eventTimestamp)) return;
    recordLatest('scene', payload.eventTimestamp);
    handlers.onTeam(payload);
  });
  connection.on('ScenePatientList', (payload: ScenePatientList) => {
    if (!active || !acceptMembership(payload.eventTimestamp)) return;
    recordLatest('scene', payload.eventTimestamp);
    handlers.onPatientList(payload);
  });

  const state = (value: ConnectionState) => active && handlers.onState(value);
  connection.onreconnecting(() => state('polling'));
  connection.onreconnected(() => {
    if (!active) return;
    connection
      .invoke('JoinScene', sceneId)
      .then(() => state('connected'))
      .catch(() => state('polling'));
  });

  // A failed first start and a close (typically the 15-minute access token expiring) are not
  // covered by automatic reconnect: poll meanwhile and start again with a fresh token.
  const start = () => {
    if (!active) return;
    connection
      .start()
      .then(() => (active ? connection.invoke('JoinScene', sceneId) : undefined))
      .then(() => state('connected'))
      .catch(() => {
        state('polling');
        retryTimer = setTimeout(start, MAX_RETRY_DELAY_MS);
      });
  };
  connection.onclose(() => {
    if (!active) return;
    state('polling');
    start();
  });

  state('connecting');
  start();

  return () => {
    active = false;
    clearTimeout(retryTimer);
    if (connection.state === HubConnectionState.Disconnected) return;
    connection
      .invoke('LeaveScene', sceneId)
      .catch(() => undefined)
      .then(() => connection.stop())
      .catch(() => undefined);
  };
}

function defaultConnection(accessToken: () => string): HubConnection {
  return (
    new HubConnectionBuilder()
      .withUrl('/hubs/scene', { accessTokenFactory: accessToken })
      // Never give up: the default policy stops after about 42 s and would freeze the Lagebild.
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: ({ previousRetryCount }) => Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** previousRetryCount) })
      .configureLogging(LogLevel.Warning)
      .build()
  );
}
