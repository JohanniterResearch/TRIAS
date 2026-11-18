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
        if (!(await this.captureLocation(result.patient.id))) return;
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

  protected async createManual(): Promise<void> {
    const scene = this.state.scene();
    if (!scene) {
      return;
    }

    this.run();
    try {
      // The existing durable queue owns the order before the very first HTTP attempt.
      const patient = await this.offlineQueue.createProvisionalPatient({
        operationSceneId: scene.id,
        name: this.manualForm.controls.name.value || undefined,
        clientGeneratedId: crypto.randomUUID(),
      });
      this.state.setPatient(patient);
      if (navigator.onLine) await this.offlineQueue.flush(true);
      const blocked = this.offlineQueue
        .blockedItems()
        .find((item) => item.patientId === patient.id);
      if (blocked) {
        this.fail(blocked.lastError ?? 'Patientenaufnahme wurde abgelehnt.');
        return;
      }
      const current = this.state.patient() ?? patient;
      if (!(await this.captureLocation(current.id))) return;
      this.busy.set(false);
      this.router.navigateByUrl(`/patient/${current.id}`);
    } catch (error) {
      this.fail(
        apiErrorMessage(error, 'Patientenaufnahme konnte nicht dauerhaft gespeichert werden.'),
      );
    }
  }

  protected online(): boolean {
    return navigator.onLine;
  }

  private async captureLocation(patientId: number): Promise<boolean> {
    const fix = await this.geo.currentPosition();
    if (!fix) {
      return true;
    }

    const body = {
      lat: fix.lat,
      lng: fix.lng,
      source: 'gps' as const,
      accuracyMeters: fix.accuracyMeters,
      clientUpdatedAt: new Date().toISOString(),
    };
    const writeId = crypto.randomUUID();
    try {
      await this.offlineQueue.queueLocation(patientId, body, writeId);
      // Start immediately, without holding up intake navigation on a network response.
      void this.offlineQueue
        .flush(true)
        .catch(() =>
          this.fail('Position konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.'),
        );
      return true;
    } catch {
      this.fail('Position konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.');
      return false;
    }
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
