import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { MyAccess } from '../../auth/components/my-access';
import { QrScanner } from '../../shared/qr-scanner';
import { ResponderStateStore } from '../services/responder-state';

@Component({
  selector: 'app-patient-choice-page',
  imports: [MyAccess, QrScanner, ReactiveFormsModule, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <p class="eyebrow">Patient</p>
      <h1>{{ label() }}</h1>

      @if (message()) {
        <p class="status-message" role="status" aria-live="polite">{{ message() }}</p>
      }
      @if (error()) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
      }
      @if (busy()) {
        <p class="status-message" role="status" aria-live="polite">QR Code wird ersetzt.</p>
      }

      <div class="choice-grid">
        <a routerLink="/triage">Triage</a>
        <a
          [routerLink]="['/ambulanzprotokoll', patientId()]"
          [state]="{ returnTo: '/patient/' + patientId() }"
          >Ambulanzprotokoll</a
        >
        <a routerLink="/triage" [state]="{ pendingProtocol: true }">Beides starten</a>
        <button type="button" disabled>Dritte Option folgt</button>
      </div>

      <form [formGroup]="reassignForm" (ngSubmit)="reassignQr()" class="auth-form">
        <h2>QR neu zuweisen</h2>
        <label>
          Neuer QR Code
          <input formControlName="qrCode" />
        </label>
        <button type="submit" [disabled]="reassignForm.invalid || busy()">QR ersetzen</button>
      </form>
      <app-qr-scanner buttonLabel="Neuen QR Code scannen" (scanned)="reassignQr($event)" />
    </section>
  `,
})
export class PatientChoicePage {
  protected readonly state = inject(ResponderStateStore);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly reassignForm = inject(FormBuilder).nonNullable.group({
    qrCode: ['', [Validators.required, Validators.maxLength(128)]],
  });

  private readonly api = inject(ApiClient);
  private readonly route = inject(ActivatedRoute);

  protected patientId(): number {
    return Number(this.route.snapshot.paramMap.get('patientId') ?? this.state.patient()?.id ?? 0);
  }

  protected label(): string {
    const patient = this.state.patient();
    return patient?.humanReadableId || `Patient ${this.patientId()}`;
  }

  protected reassignQr(qrCode = this.reassignForm.controls.qrCode.value): void {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    this.api.reassignPatientQrCode(this.patientId(), { qr_code: qrCode.trim() }).subscribe({
      next: (patient) => {
        this.state.setPatient(patient);
        this.busy.set(false);
        this.message.set('QR Code wurde ersetzt.');
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.error.set(apiErrorMessage(error, 'QR Code konnte nicht ersetzt werden.'));
      },
    });
  }
}
