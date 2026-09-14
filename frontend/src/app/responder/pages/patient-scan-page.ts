import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { QrScanner } from '../../shared/qr-scanner';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { GeolocationService } from '../services/geolocation.service';
import { ResponderStateStore } from '../services/responder-state';

@Component({
  selector: 'app-patient-scan-page',
  imports: [MyAccess, QrScanner, ReactiveFormsModule, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <p class="eyebrow">Patient aufnehmen</p>
      <h1>Patient QR scannen</h1>

      @if (!state.scene()) {
        <p class="form-error" role="alert" aria-live="assertive">
          Bitte zuerst eine Szene auswählen.
        </p>
        <a routerLink="/role-selection">Zur Szenenauswahl</a>
      } @else {
        @if (error()) {
          <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
        }
        @if (busy()) {
          <p class="status-message" role="status" aria-live="polite">Patient wird verarbeitet.</p>
        }
        @if (!online()) {
          <button type="button" (click)="createManual()" [disabled]="busy()">
            Offline manuell anlegen
          </button>
        }

        <form [formGroup]="qrForm" (ngSubmit)="verifyQr()" class="auth-form">
          <label>
            Patient QR Code
            <input formControlName="qrCode" autocomplete="off" autofocus />
          </label>
          <button type="submit" [disabled]="busy() || qrForm.invalid">QR prüfen</button>
        </form>

        <app-qr-scanner (scanned)="verifyQr($event)" />

        <h2>Manuelle Aufnahme</h2>
        <form [formGroup]="manualForm" (ngSubmit)="createManual()" class="auth-form">
          <label>
            Name optional
            <input formControlName="name" />
          </label>
          <button type="submit" [disabled]="busy()">Manuellen Patienten anlegen</button>
        </form>
      }
    </section>
  `,
})
export class PatientScanPage {
  protected readonly state = inject(ResponderStateStore);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly qrForm = inject(FormBuilder).nonNullable.group({
    qrCode: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly manualForm = inject(FormBuilder).nonNullable.group({
    name: [''],
  });

  private readonly api = inject(ApiClient);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly geo = inject(GeolocationService);
  private readonly router = inject(Router);

  protected verifyQr(qrCode = this.qrForm.controls.qrCode.value): void {
    const scene = this.state.scene();
    if (!scene) {
      return;
    }

    this.run();
    this.api.verifyPatientQrCode({ qr_code: qrCode.trim(), operationSceneId: scene.id }).subscribe({
      next: async (result) => {
        this.state.setPatient(result.patient);
        await this.captureLocation(result.patient.id);
        this.router.navigateByUrl(`/patient/${result.patient.id}`);
      },
      error: (error: unknown) =>
        this.fail(
          apiErrorMessage(
            error,
            'Patient QR Code ist unbekannt oder kann offline nicht geprüft werden.',
          ),
        ),
    });
  }

  protected createManual(): void {
    const scene = this.state.scene();
    if (!scene) {
      return;
    }

    const clientGeneratedId = crypto.randomUUID();
    this.run();
    this.api
      .createManualPatient({
        operationSceneId: scene.id,
        name: this.manualForm.controls.name.value || undefined,
        clientGeneratedId,
      })
      .subscribe({
        next: async (patient) => {
          this.state.setPatient(patient);
          await this.captureLocation(patient.id);
          this.router.navigateByUrl(`/patient/${patient.id}`);
        },
        error: (error: unknown) =>
          navigator.onLine
            ? this.fail(apiErrorMessage(error, 'Patient konnte nicht angelegt werden.'))
            : this.createManualOffline(clientGeneratedId),
      });
  }

  protected online(): boolean {
    return navigator.onLine;
  }

  private async captureLocation(patientId: number): Promise<void> {
    const fix = await this.geo.currentPosition();
    if (!fix) {
      return;
    }

    this.api
      .updatePatientLocation(patientId, {
        lat: fix.lat,
        lng: fix.lng,
        source: 'gps',
        accuracyMeters: fix.accuracyMeters,
      })
      .subscribe({ next: (patient) => this.state.setPatient(patient), error: () => undefined });
  }

  private async createManualOffline(clientGeneratedId = crypto.randomUUID()): Promise<void> {
    const scene = this.state.scene();
    if (!scene) {
      return;
    }

    const patient = await this.offlineQueue.createProvisionalPatient({
      operationSceneId: scene.id,
      name: this.manualForm.controls.name.value || undefined,
      clientGeneratedId,
    });
    this.state.setPatient(patient);
    this.busy.set(false);
    this.router.navigateByUrl(`/patient/${patient.id}`);
  }

  private run(): void {
    this.busy.set(true);
    this.error.set('');
  }

  private fail(message: string): void {
    this.busy.set(false);
    this.error.set(message);
  }
}
