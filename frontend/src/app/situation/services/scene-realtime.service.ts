import { Injectable, inject } from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { Observable, Subject } from 'rxjs';

import { environment } from '../../../environments/environment';
import type { components } from '../../api/openapi-types';
import { AuthStore } from '../../auth/auth.store';

type Patient = components['schemas']['Patient'];
type Team = components['schemas']['Team'];

export interface SceneSnapshot {
  sceneId: number;
  patients: Patient[];
  teams: Team[];
  eventTimestamp: string;
}

export interface PatientUpdated {
  sceneId: number;
  patient: Patient;
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

export type SceneRealtimeEvent =
  | { type: 'snapshot'; payload: SceneSnapshot }
  | { type: 'patient'; payload: PatientUpdated }
  | { type: 'team'; payload: TeamUpdated }
  | { type: 'patient-list'; payload: ScenePatientList }
  | { type: 'state'; payload: 'connected' | 'polling' };

@Injectable({ providedIn: 'root' })
export class SceneRealtimeService {
  private readonly auth = inject(AuthStore);
  private connection: HubConnection | null = null;
  private events: Subject<SceneRealtimeEvent> | null = null;
  private sceneId: number | null = null;
  private generation = 0;
  private readonly timestamps = new Map<string, bigint>();

  connect(sceneId: number): Observable<SceneRealtimeEvent> {
    if (this.connection && this.sceneId !== null) {
      this.disconnect(this.sceneId);
    }
    const events = new Subject<SceneRealtimeEvent>();
    const hubUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/hubs/scene`;

    const connection = new HubConnectionBuilder()
      .withUrl(hubUrl, { accessTokenFactory: () => this.auth.bearerToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
    const generation = ++this.generation;
    this.connection = connection;
    this.events = events;
    this.sceneId = sceneId;
    this.timestamps.clear();

    const current = () =>
      this.connection === connection && this.generation === generation && this.sceneId === sceneId;
    const emit = (event: SceneRealtimeEvent) => current() && events.next(event);

    connection.on('SceneSnapshot', (payload: SceneSnapshot) => {
      if (!current() || !this.accept('scene', payload.eventTimestamp)) return;
      for (const patient of payload.patients)
        this.record(`patient:${patient.id}`, payload.eventTimestamp);
      for (const team of payload.teams) this.record(`team:${team.id}`, payload.eventTimestamp);
      emit({ type: 'snapshot', payload });
    });
    connection.on('PatientUpdated', (payload: PatientUpdated) => {
      if (current() && this.accept(`patient:${payload.patient.id}`, payload.eventTimestamp)) {
        this.recordLatest('scene', payload.eventTimestamp);
        emit({ type: 'patient', payload });
      }
    });
    connection.on('TeamUpdated', (payload: TeamUpdated) => {
      if (current() && this.accept(`team:${payload.team.id}`, payload.eventTimestamp)) {
        this.recordLatest('scene', payload.eventTimestamp);
        emit({ type: 'team', payload });
      }
    });
    connection.on('ScenePatientList', (payload: ScenePatientList) => {
      if (current() && this.acceptMembership(payload.eventTimestamp)) {
        this.recordLatest('scene', payload.eventTimestamp);
        emit({ type: 'patient-list', payload });
      }
    });
    connection.onreconnected(() => {
      if (current()) {
        connection
          .invoke('JoinScene', sceneId)
          .then(() => emit({ type: 'state', payload: 'connected' }))
          .catch(() => emit({ type: 'state', payload: 'polling' }));
      }
    });

    connection
      .start()
      .then(() => (current() ? connection.invoke('JoinScene', sceneId) : undefined))
      .then(() => emit({ type: 'state', payload: 'connected' }))
      .catch(() => emit({ type: 'state', payload: 'polling' }));

    return events.asObservable();
  }

  disconnect(sceneId: number): void {
    if (sceneId !== this.sceneId) {
      return;
    }
    const connection = this.connection;
    const events = this.events;
    ++this.generation;
    this.connection = null;
    this.events = null;
    this.sceneId = null;
    this.timestamps.clear();
    events?.complete();
    if (!connection || connection.state === HubConnectionState.Disconnected) {
      return;
    }

    connection
      .invoke('LeaveScene', sceneId)
      .catch(() => undefined)
      .then(() => connection.stop())
      .catch(() => undefined);
  }

  private accept(key: string, timestamp: string): boolean {
    const value = timestampValue(timestamp);
    if (value === null || value <= (this.timestamps.get(key) ?? -1n)) {
      return false;
    }
    this.timestamps.set(key, value);
    return true;
  }

  private record(key: string, timestamp: string): void {
    const value = timestampValue(timestamp);
    if (value !== null) this.timestamps.set(key, value);
  }

  private recordLatest(key: string, timestamp: string): void {
    const value = timestampValue(timestamp);
    if (value !== null && value > (this.timestamps.get(key) ?? -1n))
      this.timestamps.set(key, value);
  }

  private acceptMembership(timestamp: string): boolean {
    const value = timestampValue(timestamp);
    if (value === null) return false;
    if (value <= (this.timestamps.get('scene') ?? -1n)) return false;
    if (value <= (this.timestamps.get('patient-list') ?? -1n)) return false;
    this.timestamps.set('patient-list', value);
    return true;
  }
}

function timestampValue(timestamp: string): bigint | null {
  const utc = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(timestamp);
  if (utc) {
    const seconds = Date.parse(`${utc[1]}Z`);
    if (!Number.isFinite(seconds)) return null;
    const fraction = (utc[2] ?? '').slice(0, 9).padEnd(9, '0');
    return BigInt(seconds) * 1_000_000n + BigInt(fraction || '0');
  }
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1_000_000n : null;
}
