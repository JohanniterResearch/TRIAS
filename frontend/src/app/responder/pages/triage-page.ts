import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  effect,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { SyncStatusService } from '../../sync/sync-status.service';
import { ResponderStateStore } from '../services/responder-state';
import { TriageDraftStore } from '../services/triage-draft-store';

type TriageColor = components['schemas']['TriageColor'];

@Component({
  selector: 'app-triage-page',
  imports: [DecimalPipe, MyAccess, ReactiveFormsModule, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <h1>Triage erfassen</h1>

      @if (!state.patient()) {
        <p class="form-error" role="alert" aria-live="assertive">Kein Patient ausgewählt.</p>
        <a routerLink="/scan-patient">Patient aufnehmen</a>
      } @else {
        @if (message()) {
          <p class="status-message" role="status" aria-live="polite">{{ message() }}</p>
        }
        @if (error()) {
          <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
        }

        <div class="triage-colors">
          @for (color of colors; track color.value) {
            <button
              type="button"
              [class]="color.value"
              (click)="save({ triageColor: color.value })"
            >
              {{ color.label }}
            </button>
          }
        </div>

        <form [formGroup]="flagsForm" class="flag-grid">
          @for (flag of flags; track flag.name) {
            <label>
              <input
                type="checkbox"
                [formControlName]="flag.name"
                (change)="saveFlags(flag.name)"
              />
              {{ flag.label }}
            </label>
          }
        </form>

        <form [formGroup]="locationForm" (ngSubmit)="saveManualLocation()" class="auth-form">
          <h2>Position korrigieren</h2>
          @if (state.patient()?.locationAccuracyMeters; as accuracy) {
            <p [class.form-error]="accuracy > 10">
              GPS Genauigkeit: {{ accuracy | number: '1.0-0' }} m
              @if (accuracy > 10) {
                <span> · unzuverlässig, bitte korrigieren</span>
              }
            </p>
          }
          <label>
            Latitude
            <input formControlName="lat" type="number" step="any" />
          </label>
          <label>
            Longitude
            <input formControlName="lng" type="number" step="any" />
          </label>
          <label>
            Innenbereich
            <input formControlName="indoorLocation" placeholder="Zelt, Sektor, Raum" />
          </label>
          <p>Indoor-GPS kann ungenau sein; Sektor/Zelt/Raum ergänzen.</p>
          <div
            #locationMap
            class="location-correction-map"
            aria-label="Position auf Karte korrigieren"
          ></div>
          <button type="submit">Position speichern</button>
        </form>

        <div class="row-actions">
          <a routerLink="/body/front">Körper vorne markieren</a>
          <a routerLink="/body/back">Körper hinten markieren</a>
          <a
            [routerLink]="['/ambulanzprotokoll', state.patient()?.id]"
            [state]="{ returnTo: '/triage' }"
            >Ambulanzprotokoll</a
          >
        </div>
        @if (pendingProtocol()) {
          <div class="row-actions">
            <button type="button" (click)="continueToProtocol()">
              Weiter zum Ambulanzprotokoll
            </button>
            <button type="button" (click)="pendingProtocol.set(false)">Überspringen</button>
          </div>
        }
      }
    </section>
  `,
})
export class TriagePage implements AfterViewInit, OnDestroy {
  protected readonly state = inject(ResponderStateStore);
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly pendingProtocol = signal(history.state.pendingProtocol === true);
  protected readonly flagsForm = inject(FormBuilder).nonNullable.group({
    respiration: [null as boolean | null],
    blutung: [null as boolean | null],
    radialispuls: [null as boolean | null],
    transport: [null as boolean | null],
    dringend: [null as boolean | null],
    kontaminiert: [null as boolean | null],
  });
  protected readonly locationForm = inject(FormBuilder).nonNullable.group({
    lat: [null as number | null],
    lng: [null as number | null],
    indoorLocation: [''],
  });
  protected readonly colors: Array<{ value: TriageColor; label: string }> = [
    { value: 'rot', label: 'Rot' },
    { value: 'gelb', label: 'Gelb' },
    { value: 'gruen', label: 'Grün' },
    { value: 'schwarz', label: 'Schwarz' },
  ];
  protected readonly flags = [
    { name: 'respiration', label: 'Atmung' },
    { name: 'blutung', label: 'Blutung' },
    { name: 'radialispuls', label: 'Radialispuls' },
    { name: 'transport', label: 'Transport' },
    { name: 'dringend', label: 'Dringend' },
    { name: 'kontaminiert', label: 'Kontaminiert' },
  ] as const;

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly drafts = inject(TriageDraftStore);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly syncStatus = inject(SyncStatusService);
  private readonly locationMap = viewChild<ElementRef<HTMLDivElement>>('locationMap');
  private map: L.Map | null = null;
  private marker: L.CircleMarker | null = null;
  private flagsRevision = 0;

  constructor() {
    effect(() => {
      this.syncStatus.lastSuccessfulQueueFlush();
      this.syncStatus.pendingCount();
      const patient = this.state.patient();
      if (patient) void this.restoreFlags(patient);
    });
    const patient = this.state.patient();
    if (!patient) {
      return;
    }
    const draft = this.drafts.get(patient.id);
    this.locationForm.patchValue(draft);
  }

  ngAfterViewInit(): void {
    const element = this.locationMap()?.nativeElement;
    if (!element) {
      return;
    }
    const patient = this.state.patient();
    const lat = patient?.latitudePatient ?? 48.2082;
    const lng = patient?.longitudePatient ?? 16.3738;
    this.map = L.map(element).setView([lat, lng], patient?.latitudePatient == null ? 13 : 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
    if (patient?.latitudePatient != null && patient.longitudePatient != null) {
      this.setMarker(patient.latitudePatient, patient.longitudePatient);
      this.locationForm.patchValue({
        lat: patient.latitudePatient,
        lng: patient.longitudePatient,
        indoorLocation: patient.indoorLocation ?? '',
      });
    }
    this.map.on('click', ({ latlng }: L.LeafletMouseEvent) => {
      this.locationForm.patchValue({ lat: latlng.lat, lng: latlng.lng });
      this.setMarker(latlng.lat, latlng.lng);
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  protected saveFlags(flag: (typeof this.flags)[number]['name']): void {
    this.save({ [flag]: this.flagsForm.controls[flag].value });
  }

  private async restoreFlags(patient: components['schemas']['Patient']): Promise<void> {
    const revision = ++this.flagsRevision;
    this.flagsForm.patchValue({
      respiration: patient.atmung ?? null,
      blutung: patient.blutung ?? null,
      radialispuls: patient.radialispuls ?? null,
      transport: patient.transport ?? null,
      dringend: patient.dringend ?? null,
      kontaminiert: patient.kontaminiert ?? null,
    });
    try {
      const pending = await this.offlineQueue.pendingTriage(patient.id);
      if (revision !== this.flagsRevision || this.state.patient()?.id !== patient.id) return;
      for (const intent of pending) this.flagsForm.patchValue(intent);
    } catch {
      this.error.set('Lokale Triage-Änderungen konnten nicht geladen werden.');
    }
  }

  protected save(body: object): void {
    const patient = this.state.patient();
    if (!patient) {
      return;
    }

    const queuedBody = { ...body, clientUpdatedAt: new Date().toISOString() };
    ++this.flagsRevision;
    this.error.set('');
    this.api.updateTriage(patient.id, queuedBody).subscribe({
      next: (updated) => {
        this.state.setPatient(updated);
        this.message.set('Gespeichert.');
      },
      error: (error: unknown) => {
        const message = apiErrorMessage(error, '');
        if (message) {
          this.error.set(message);
          return;
        }
        this.offlineQueue
          .queueTriage(patient.id, queuedBody)
          .then(() => this.message.set('Lokal gespeichert, Sync ausstehend.'))
          .catch(() => {
            this.message.set('');
            this.error.set('Lokale Sync-Warteschlange konnte nicht gespeichert werden.');
          });
      },
    });
  }

  protected saveManualLocation(): void {
    const patient = this.state.patient();
    const raw = this.locationForm.getRawValue();
    if (!patient || raw.lat === null || raw.lng === null) {
      this.error.set('Latitude und Longitude sind erforderlich.');
      return;
    }

    this.api
      .updatePatientLocation(patient.id, {
        lat: Number(raw.lat),
        lng: Number(raw.lng),
        source: 'manual',
        indoorLocation: raw.indoorLocation || undefined,
      })
      .subscribe({
        next: (updated) => {
          this.state.setPatient(updated);
          this.message.set('Position gespeichert.');
        },
        error: (error: unknown) =>
          this.error.set(apiErrorMessage(error, 'Position konnte nicht gespeichert werden.')),
      });
  }

  protected continueToProtocol(): void {
    const patientId = this.state.patient()?.id;
    if (patientId) {
      this.router.navigate(['/ambulanzprotokoll', patientId], { state: { returnTo: '/triage' } });
    }
  }

  private setMarker(lat: number, lng: number): void {
    this.marker?.remove();
    this.marker = L.circleMarker([lat, lng], {
      radius: 9,
      color: '#102033',
      fillColor: '#d32f2f',
      fillOpacity: 0.9,
    }).addTo(this.map!);
  }
}
