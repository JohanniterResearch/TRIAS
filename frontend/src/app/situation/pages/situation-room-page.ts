import { DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as L from 'leaflet';
import { Subscription, interval, switchMap } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { SceneRealtimeService } from '../services/scene-realtime.service';

type Patient = components['schemas']['Patient'];
type Team = components['schemas']['Team'];
type TriageColor = components['schemas']['TriageColor'];

@Component({
  selector: 'app-situation-room-page',
  imports: [DecimalPipe, MyAccess, ReactiveFormsModule, RouterLink],
  template: `
    <section class="situation-page">
      <app-my-access />
      <header class="situation-header">
        <div>
          <p class="eyebrow">F6 Lagebild</p>
          <h1>Situation Room</h1>
        </div>
        <form [formGroup]="sceneForm" (ngSubmit)="setScene()" class="scene-select">
          <label>
            Szene ID
            <input formControlName="sceneId" type="number">
          </label>
          <button type="submit" [disabled]="sceneForm.invalid">Öffnen</button>
        </form>
      </header>

      @if (error()) {
        <p class="form-error">{{ error() }}</p>
      }

      <div class="triage-counts">
        @for (count of triageCounts(); track count.label) {
          <span [class]="count.color">{{ count.label }}: {{ count.value }}</span>
        }
      </div>

      <div class="situation-layout">
        <div #map class="situation-map"></div>

        <section class="patient-panel">
          <div class="row-actions">
            <button type="button" (click)="refresh()">Aktualisieren</button>
            <button type="button" (click)="showHistory.set(!showHistory())">
              {{ showHistory() ? 'Aktuelle Triage' : 'Triage-Historie' }}
            </button>
            <span>{{ realtimeState() }}</span>
          </div>

          <table class="patient-table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Atmung</th>
                <th>Blutung</th>
                <th>Triage</th>
                <th>Transport</th>
                <th>Dringend</th>
                <th>Name</th>
                <th>Lon/Lat</th>
                <th>Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              @for (patient of patients(); track patient.id) {
                <tr tabindex="0" (click)="selectPatient(patient)" (keydown.enter)="selectPatient(patient)">
                  <td>{{ patient.humanReadableId || patient.id }}</td>
                  <td>{{ bool(patient.atmung) }}</td>
                  <td>{{ bool(patient.blutung) }}</td>
                  <td>{{ triageLabel(patient.triagefarbe) }}</td>
                  <td>{{ bool(patient.transport) }}</td>
                  <td>{{ bool(patient.dringend) }}</td>
                  <td>{{ patient.name || '-' }}</td>
                  <td>{{ patient.longitudePatient | number: '1.4-4' }} / {{ patient.latitudePatient | number: '1.4-4' }}</td>
                  <td>{{ patient.updatedAt }}</td>
                </tr>
              }
            </tbody>
          </table>

          @if (selectedPatient(); as patient) {
            <div class="selected-panel">
              <strong>Patient {{ patient.humanReadableId || patient.id }}</strong>
              <div class="row-actions">
                <a [routerLink]="['/ambulanzprotokoll', patient.id]">Ambulanzprotokoll</a>
                <a routerLink="/triage">Triage öffnen</a>
              </div>
              @if (showHistory()) {
                <button type="button" (click)="loadHistory(patient.id)">Historie laden</button>
                <ul>
                  @for (entry of history(); track entry.timestamp + entry.field) {
                    <li>{{ entry.timestamp }} · {{ entry.field }}: {{ entry.before || '-' }} → {{ entry.after || '-' }}</li>
                  }
                </ul>
              }
            </div>
          }
        </section>

        <section class="team-panel">
          <h2>Teams</h2>
          <form [formGroup]="teamForm" (ngSubmit)="createTeam()" class="auth-form">
            <label>
              Name / Funkruf
              <input formControlName="name">
            </label>
            <button type="submit" [disabled]="teamForm.invalid">Team anlegen</button>
          </form>

          @for (team of teams(); track team.id) {
            <article>
              <strong>{{ team.name }}</strong>
              <select [value]="team.status || ''" (change)="updateTeam(team, $any($event.target).value || null)">
                <option value="">Status offen</option>
                <option value="free">frei</option>
                <option value="busy">beschäftigt</option>
                <option value="unavailable">nicht verfügbar</option>
              </select>
              <span>{{ team.assignedLocation || '-' }}</span>
            </article>
          }
        </section>
      </div>
    </section>
  `,
})
export class SituationRoomPage implements AfterViewInit, OnDestroy {
  protected readonly patients = signal<Patient[]>([]);
  protected readonly teams = signal<Team[]>([]);
  protected readonly history = signal<components['schemas']['TriageHistoryEntry'][]>([]);
  protected readonly selectedPatient = signal<Patient | null>(null);
  protected readonly showHistory = signal(false);
  protected readonly error = signal('');
  protected readonly realtimeState = signal('nicht verbunden');
  protected readonly triageCounts = computed(() => {
    const counts = new Map<string, number>([
      ['rot', 0],
      ['gelb', 0],
      ['gruen', 0],
      ['schwarz', 0],
      ['unassigned', 0],
    ]);
    for (const patient of this.patients()) {
      counts.set(patient.triagefarbe ?? 'unassigned', (counts.get(patient.triagefarbe ?? 'unassigned') ?? 0) + 1);
    }
    return [
      { label: 'Rot', color: 'rot', value: counts.get('rot') ?? 0 },
      { label: 'Gelb', color: 'gelb', value: counts.get('gelb') ?? 0 },
      { label: 'Grün', color: 'gruen', value: counts.get('gruen') ?? 0 },
      { label: 'Schwarz', color: 'schwarz', value: counts.get('schwarz') ?? 0 },
      { label: 'Ohne', color: 'unassigned', value: counts.get('unassigned') ?? 0 },
    ];
  });

  protected readonly sceneForm = inject(FormBuilder).nonNullable.group({
    sceneId: [inject(ResponderStateStore).scene()?.id ?? null as number | null, Validators.required],
  });
  protected readonly teamForm = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
  });

  private readonly api = inject(ApiClient);
  private readonly realtime = inject(SceneRealtimeService);
  private readonly mapElement = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private markers = L.layerGroup();
  private realtimeSub: Subscription | null = null;
  private pollingSub: Subscription | null = null;

  ngAfterViewInit(): void {
    this.initMap();
    if (this.sceneId()) {
      this.connect();
    }
  }

  ngOnDestroy(): void {
    const sceneId = this.sceneId();
    if (sceneId) {
      this.realtime.disconnect(sceneId);
    }
    this.realtimeSub?.unsubscribe();
    this.pollingSub?.unsubscribe();
    this.map?.remove();
  }

  protected setScene(): void {
    this.connect();
  }

  protected refresh(): void {
    const sceneId = this.sceneId();
    if (!sceneId) {
      return;
    }
    this.error.set('');
    this.api.listPatients(sceneId).subscribe({
      next: (patients) => {
        this.patients.set(patients);
        this.renderMarkers();
      },
      error: () => this.error.set('Patienten konnten nicht geladen werden.'),
    });
    this.api.listTeams(sceneId).subscribe({
      next: (teams) => this.teams.set(teams),
      error: () => undefined,
    });
  }

  protected selectPatient(patient: Patient): void {
    this.selectedPatient.set(patient);
  }

  protected loadHistory(patientId: number): void {
    this.api.getTriageHistory(patientId).subscribe({
      next: (history) => this.history.set(history),
      error: () => this.error.set('Triage-Historie konnte nicht geladen werden.'),
    });
  }

  protected createTeam(): void {
    const sceneId = this.sceneId();
    if (!sceneId) {
      return;
    }
    this.api.createTeam({ operationSceneId: sceneId, name: this.teamForm.controls.name.value }).subscribe({
      next: (team) => {
        this.upsertTeam(team);
        this.teamForm.reset({ name: '' });
      },
      error: () => this.error.set('Team konnte nicht angelegt werden.'),
    });
  }

  protected updateTeam(team: Team, status: Team['status']): void {
    this.api.updateTeam(team.id, { status }).subscribe({
      next: (updated) => this.upsertTeam(updated),
      error: () => this.error.set('Team konnte nicht aktualisiert werden.'),
    });
  }

  protected bool(value?: boolean | null): string {
    return value === true ? 'ja' : value === false ? 'nein' : '-';
  }

  protected triageLabel(value?: TriageColor | null): string {
    return value === 'gruen' ? 'grün' : value ?? '-';
  }

  private connect(): void {
    const sceneId = this.sceneId();
    if (!sceneId) {
      this.error.set('Bitte Szene ID wählen.');
      return;
    }
    this.realtimeSub?.unsubscribe();
    this.pollingSub?.unsubscribe();
    this.refresh();
    this.realtimeSub = this.realtime.connect(sceneId).subscribe((event) => {
      if (event.type === 'state') {
        this.realtimeState.set(event.payload === 'connected' ? 'live' : 'polling');
        if (event.payload === 'polling') {
          this.startPolling(sceneId);
        }
      }
      if (event.type === 'snapshot') {
        this.patients.set(event.payload.patients);
        this.teams.set(event.payload.teams);
        this.renderMarkers();
      }
      if (event.type === 'patient') {
        this.upsertPatient(event.payload.patient);
      }
      if (event.type === 'team') {
        this.upsertTeam(event.payload.team);
      }
    });
  }

  private startPolling(sceneId: number): void {
    this.pollingSub = interval(10000).pipe(switchMap(() => this.api.listPatients(sceneId))).subscribe((patients) => {
      this.patients.set(patients);
      this.renderMarkers();
    });
  }

  private sceneId(): number | null {
    return this.sceneForm.controls.sceneId.value;
  }

  private initMap(): void {
    const element = this.mapElement()?.nativeElement;
    if (!element || this.map) {
      return;
    }
    this.map = L.map(element).setView([48.2082, 16.3738], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
    this.markers.addTo(this.map);
  }

  private renderMarkers(): void {
    this.markers.clearLayers();
    const points = this.patients().filter((patient) => patient.latitudePatient != null && patient.longitudePatient != null);
    for (const patient of points) {
      L.marker([patient.latitudePatient!, patient.longitudePatient!])
        .bindPopup(`${patient.humanReadableId || patient.id} · ${this.triageLabel(patient.triagefarbe)}`)
        .addTo(this.markers);
    }
    if (points.length && this.map) {
      this.map.fitBounds(points.map((patient) => [patient.latitudePatient!, patient.longitudePatient!] as L.LatLngTuple), { maxZoom: 16 });
    }
  }

  private upsertPatient(patient: Patient): void {
    this.patients.update((patients) => [...patients.filter((item) => item.id !== patient.id), patient].sort((a, b) => a.id - b.id));
    this.renderMarkers();
  }

  private upsertTeam(team: Team): void {
    this.teams.update((teams) => [...teams.filter((item) => item.id !== team.id), team].sort((a, b) => a.id - b.id));
  }
}
