import { Injectable, inject } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
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

export type SceneRealtimeEvent =
  | { type: 'snapshot'; payload: SceneSnapshot }
  | { type: 'patient'; payload: PatientUpdated }
  | { type: 'team'; payload: TeamUpdated }
  | { type: 'state'; payload: 'connected' | 'polling' };

@Injectable({ providedIn: 'root' })
export class SceneRealtimeService {
  private readonly auth = inject(AuthStore);
  private connection: HubConnection | null = null;

  connect(sceneId: number): Observable<SceneRealtimeEvent> {
    const events = new Subject<SceneRealtimeEvent>();
    const hubUrl = `${environment.apiBaseUrl.replace(/\/$/, '')}/hubs/scene`;

    this.connection = new HubConnectionBuilder()
      .withUrl(hubUrl, { accessTokenFactory: () => this.auth.bearerToken() ?? '' })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.on('SceneSnapshot', (payload: SceneSnapshot) => events.next({ type: 'snapshot', payload }));
    this.connection.on('PatientUpdated', (payload: PatientUpdated) => events.next({ type: 'patient', payload }));
    this.connection.on('TeamUpdated', (payload: TeamUpdated) => events.next({ type: 'team', payload }));
    this.connection.onreconnected(() => this.connection?.invoke('JoinScene', sceneId));

    this.connection.start()
      .then(() => this.connection?.invoke('JoinScene', sceneId))
      .then(() => events.next({ type: 'state', payload: 'connected' }))
      .catch(() => events.next({ type: 'state', payload: 'polling' }));

    return events.asObservable();
  }

  disconnect(sceneId: number): void {
    const connection = this.connection;
    this.connection = null;
    if (!connection || connection.state === HubConnectionState.Disconnected) {
      return;
    }

    connection.invoke('LeaveScene', sceneId).finally(() => connection.stop());
  }
}
