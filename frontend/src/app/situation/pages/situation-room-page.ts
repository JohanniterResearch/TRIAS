import { DatePipe, DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import { Subscription, interval, switchMap } from 'rxjs';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { SceneRealtimeService } from '../services/scene-realtime.service';

type Patient = components['schemas']['Patient'];
type Team = components['schemas']['Team'];
type TriageColor = components['schemas']['TriageColor'];

@Component({
  selector: 'app-situation-room-page',
  imports: [DatePipe, DecimalPipe, MyAccess, ReactiveFormsModule, RouterLink],
  template: `
    <section class="situation-page">
      <app-my-access />
      <header class="situation-header">
        <div>
          <h1>Situation Room</h1>
        </div>
        <form [formGroup]="sceneForm" (ngSubmit)="setScene()" class="scene-select">
          <label>
            Szene ID
            <input formControlName="sceneId" type="number" />
          </label>
          <button type="submit" [disabled]="sceneForm.invalid">Öffnen</button>
        </form>
      </header>

      @if (error()) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
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
            <button type="button" (click)="toggleHistory()">
              {{ showHistory() ? 'Aktuelle Triage' : 'Triage-Historie' }}
            </button>
            <span role="status" aria-live="polite">{{ realtimeState() }}</span>
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
                <th>Erstellt</th>
                <th>Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              @for (patient of patients(); track patient.id) {
                <tr
                  tabindex="0"
                  (click)="openProtocol(patient)"
                  (keydown.enter)="openProtocol(patient)"
                >
                  <td>{{ patient.humanReadableId || patient.id }}</td>
                  <td>{{ bool(patient.atmung) }}</td>
                  <td>{{ bool(patient.blutung) }}</td>
                  <td>{{ triageLabel(patient.triagefarbe) }}</td>
                  <td>{{ bool(patient.transport) }}</td>
                  <td>{{ bool(patient.dringend) }}</td>
                  <td>{{ patient.name || '-' }}</td>
                  <td>
                    {{ patient.longitudePatient | number: '1.4-4' }} /
                    {{ patient.latitudePatient | number: '1.4-4' }}
                  </td>
                  <td>{{ patient.createdAt | date: 'short' }}</td>
                  <td>{{ patient.updatedAt | date: 'short' }}</td>
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
                    <li>
                      {{ entry.timestamp }} · {{ entry.field }}: {{ entry.before || '-' }} →
                      {{ entry.after || '-' }}
                    </li>
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
              <input formControlName="name" />
            </label>
            <button type="submit" [disabled]="teamForm.invalid">Team anlegen</button>
          </form>

          @for (team of teams(); track team.id) {
            <article>
              <strong>{{ team.name }}</strong>
              <select
                [value]="team.status || ''"
                (change)="updateTeam(team, { status: $any($event.target).value || null })"
              >
                <option value="">Status offen</option>
                <option value="free">frei</option>
                <option value="busy">beschäftigt</option>
                <option value="unavailable">nicht verfügbar</option>
              </select>
              <label>
                Patient ID
                <input
                  type="number"
                  [value]="team.assignedPatientId ?? ''"
                  (change)="
                    updateTeam(team, { assignedPatientId: numberOrNull($any($event.target).value) })
                  "
                />
              </label>
              <label>
                Einsatzort
                <input
                  [value]="team.assignedLocation ?? ''"
                  (change)="
                    updateTeam(team, { assignedLocation: $any($event.target).value || null })
                  "
                />
              </label>
              <label>
                Kontakt
                <input
                  [value]="team.contactInfo ?? ''"
                  (change)="updateTeam(team, { contactInfo: $any($event.target).value || null })"
                />
              </label>
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
      const value = patient.triagefarbe ?? 'unassigned';
      const key = counts.has(value) ? value : 'invalid';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [
      { label: 'Rot', color: 'rot', value: counts.get('rot') ?? 0 },
      { label: 'Gelb', color: 'gelb', value: counts.get('gelb') ?? 0 },
      { label: 'Grün', color: 'gruen', value: counts.get('gruen') ?? 0 },
      { label: 'Schwarz', color: 'schwarz', value: counts.get('schwarz') ?? 0 },
      { label: 'Ohne', color: 'unassigned', value: counts.get('unassigned') ?? 0 },
      { label: 'Ungültig', color: 'invalid', value: counts.get('invalid') ?? 0 },
    ];
  });

  protected readonly sceneForm = inject(FormBuilder).nonNullable.group({
    sceneId: [
      Number(history.state.sceneId) || inject(ResponderStateStore).scene()?.id || null,
      Validators.required,
    ],
  });
  protected readonly teamForm = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
  });

  private readonly api = inject(ApiClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly realtime = inject(SceneRealtimeService);
  private readonly responderState = inject(ResponderStateStore);
  private readonly mapElement = viewChild<ElementRef<HTMLDivElement>>('map');
  private map: L.Map | null = null;
  private markers = L.layerGroup();
  private realtimeSub: Subscription | null = null;
  private pollingSub: Subscription | null = null;
  private refreshSub: Subscription | null = null;
  private sceneGeneration = 0;
  private refreshGeneration = 0;
  private realtimeRevision = 0;

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
    this.refreshSub?.unsubscribe();
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
    const sceneGeneration = this.sceneGeneration;
    const refreshGeneration = ++this.refreshGeneration;
    const realtimeRevision = this.realtimeRevision;
    this.refreshSub?.unsubscribe();
    this.refreshSub = new Subscription();
    this.error.set('');
    this.refreshSub.add(
      this.api
        .listPatients(sceneId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (patients) => {
            if (!this.isCurrent(sceneId, sceneGeneration, refreshGeneration, realtimeRevision))
              return;
            this.patients.set(patients);
            this.renderMarkers();
          },
          error: (error: unknown) =>
            this.isCurrent(sceneId, sceneGeneration, refreshGeneration, realtimeRevision) &&
            this.error.set(apiErrorMessage(error, 'Patienten konnten nicht geladen werden.')),
        }),
    );
    this.refreshSub.add(
      this.api
        .listTeams(sceneId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (teams) =>
            this.isCurrent(sceneId, sceneGeneration, refreshGeneration, realtimeRevision) &&
            this.teams.set(teams),
          error: () => undefined,
        }),
    );
  }

  protected openProtocol(patient: Patient): void {
    this.selectedPatient.set(patient);
    this.responderState.setPatient(patient);
    this.router.navigate(['/ambulanzprotokoll', patient.id], {
      state: { returnTo: '/situation-room', sceneId: this.sceneId() },
    });
  }

  protected toggleHistory(): void {
    this.showHistory.update((value) => !value);
    const patient = this.selectedPatient();
    if (this.showHistory() && patient) {
      this.loadHistory(patient.id);
    }
  }

  protected loadHistory(patientId: number): void {
    const sceneGeneration = this.sceneGeneration;
    this.api
      .getTriageHistory(patientId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (history) => {
          if (sceneGeneration === this.sceneGeneration && this.selectedPatient()?.id === patientId)
            this.history.set(history);
        },
        error: (error: unknown) =>
          sceneGeneration === this.sceneGeneration &&
          this.selectedPatient()?.id === patientId &&
          this.error.set(apiErrorMessage(error, 'Triage-Historie konnte nicht geladen werden.')),
      });
  }

  protected createTeam(): void {
    const sceneId = this.sceneId();
    if (!sceneId) {
      return;
    }
    const generation = this.sceneGeneration;
    this.api
      .createTeam({ operationSceneId: sceneId, name: this.teamForm.controls.name.value })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (team) => {
          if (generation !== this.sceneGeneration || this.sceneId() !== sceneId) return;
          this.upsertTeam(team);
          this.teamForm.reset({ name: '' });
        },
        error: (error: unknown) =>
          generation === this.sceneGeneration &&
          this.sceneId() === sceneId &&
          this.error.set(apiErrorMessage(error, 'Team konnte nicht angelegt werden.')),
      });
  }

  protected updateTeam(
    team: Team,
    update: Partial<
      Pick<Team, 'status' | 'assignedPatientId' | 'assignedLocation' | 'contactInfo'>
    >,
  ): void {
    const sceneId = this.sceneId();
    const generation = this.sceneGeneration;
    this.api
      .updateTeam(team.id, update)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          if (generation === this.sceneGeneration && this.sceneId() === sceneId)
            this.upsertTeam(updated);
        },
        error: (error: unknown) =>
          generation === this.sceneGeneration &&
          this.sceneId() === sceneId &&
          this.error.set(apiErrorMessage(error, 'Team konnte nicht aktualisiert werden.')),
      });
  }

  protected numberOrNull(value: string): number | null {
    return value === '' ? null : Number(value);
  }

  protected bool(value?: boolean | null): string {
    return value === true ? 'ja' : value === false ? 'nein' : '-';
  }

  protected triageLabel(value?: TriageColor | null): string {
    return value === 'gruen' ? 'grün' : (value ?? '-');
  }

  private connect(): void {
    const sceneId = this.sceneId();
    if (!sceneId) {
      this.error.set('Bitte Szene ID wählen.');
      return;
    }
    ++this.sceneGeneration;
    this.refreshGeneration = 0;
    this.realtimeRevision = 0;
    this.realtimeSub?.unsubscribe();
    this.pollingSub?.unsubscribe();
    this.refreshSub?.unsubscribe();
    this.patients.set([]);
    this.teams.set([]);
    this.history.set([]);
    this.selectedPatient.set(null);
    this.refresh();
    const generation = this.sceneGeneration;
    this.realtimeSub = this.realtime
      .connect(sceneId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        if (generation !== this.sceneGeneration || this.sceneId() !== sceneId) return;
        if (event.type === 'state') {
          this.realtimeState.set(event.payload === 'connected' ? 'live' : 'polling');
          if (event.payload === 'polling') {
            this.startPolling(sceneId);
          } else {
            this.pollingSub?.unsubscribe();
          }
        }
        if (event.type === 'snapshot') {
          ++this.realtimeRevision;
          this.patients.set(event.payload.patients);
          this.teams.set(event.payload.teams);
          this.renderMarkers();
        }
        if (event.type === 'patient') {
          ++this.realtimeRevision;
          this.upsertPatient(event.payload.patient);
        }
        if (event.type === 'team') {
          ++this.realtimeRevision;
          this.upsertTeam(event.payload.team);
        }
        if (event.type === 'patient-list') {
          ++this.realtimeRevision;
          const ids = new Set(event.payload.patientIds);
          const hasMissingPatients = event.payload.patientIds.some(
            (id) => !this.patients().some((patient) => patient.id === id),
          );
          this.patients.update((patients) => patients.filter((patient) => ids.has(patient.id)));
          const selected = this.selectedPatient();
          if (selected && !ids.has(selected.id)) {
            this.selectedPatient.set(null);
            this.history.set([]);
            if (this.responderState.patient()?.id === selected.id)
              this.responderState.clearPatient();
          }
          this.renderMarkers();
          if (hasMissingPatients) this.refresh();
        }
      });
  }

  private startPolling(sceneId: number): void {
    const generation = this.sceneGeneration;
    this.pollingSub?.unsubscribe();
    this.pollingSub = interval(10000)
      .pipe(
        switchMap(() => this.api.listPatients(sceneId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (patients) => {
          if (generation !== this.sceneGeneration || this.sceneId() !== sceneId) return;
          this.patients.set(patients);
          this.renderMarkers();
        },
        error: () => this.error.set('Live-Verbindung und Aktualisierung sind unterbrochen.'),
      });
  }

  private sceneId(): number | null {
    return this.sceneForm.controls.sceneId.value;
  }

  private isCurrent(
    sceneId: number,
    sceneGeneration: number,
    refreshGeneration: number,
    realtimeRevision: number,
  ): boolean {
    return (
      this.sceneId() === sceneId &&
      this.sceneGeneration === sceneGeneration &&
      this.refreshGeneration === refreshGeneration &&
      this.realtimeRevision === realtimeRevision
    );
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
    const points = this.patients().filter(
      (patient) => patient.latitudePatient != null && patient.longitudePatient != null,
    );
    for (const patient of points) {
      const label = `${patient.humanReadableId || patient.id} · ${this.triageLabel(patient.triagefarbe)}`;
      L.circleMarker([patient.latitudePatient!, patient.longitudePatient!], {
        radius: 10,
        color: '#ffffff',
        weight: 2,
        fillColor: triageColor(patient.triagefarbe),
        fillOpacity: 1,
      })
        .bindTooltip(label, { permanent: true, direction: 'top' })
        .bindPopup(label)
        .on('click', () => this.openProtocol(patient))
        .addTo(this.markers);
    }
    if (points.length && this.map) {
      this.map.fitBounds(
        points.map(
          (patient) => [patient.latitudePatient!, patient.longitudePatient!] as L.LatLngTuple,
        ),
        { maxZoom: 16 },
      );
    }
  }

  private upsertPatient(patient: Patient): void {
    this.patients.update((patients) =>
      [...patients.filter((item) => item.id !== patient.id), patient].sort((a, b) => a.id - b.id),
    );
    this.renderMarkers();
  }

  private upsertTeam(team: Team): void {
    this.teams.update((teams) =>
      [...teams.filter((item) => item.id !== team.id), team].sort((a, b) => a.id - b.id),
    );
  }
}

function triageColor(value?: TriageColor | null): string {
  return (
    (
      { rot: '#b3261e', gelb: '#b77900', gruen: '#188038', schwarz: '#1f2933' } as Record<
        string,
        string
      >
    )[value ?? ''] ?? '#52606d'
  );
}
