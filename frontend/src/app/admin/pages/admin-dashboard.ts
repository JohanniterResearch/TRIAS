import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { QrCodeImage } from '../components/qr-code-image';

type OperationScene = components['schemas']['OperationScene'];
type LoginQrCode = components['schemas']['LoginQrCode'];

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, MyAccess, QrCodeImage, ReactiveFormsModule, RouterLink],
  template: `
    <section class="admin-page">
      <app-my-access />
      <header>
        <p class="eyebrow">F3 Admin</p>
        <h1>Administration</h1>
      </header>

      @if (message()) {
        <p class="status-message">{{ message() }}</p>
      }
      @if (error()) {
        <p class="form-error">{{ error() }}</p>
      }

      <div class="admin-grid">
        <section class="admin-panel">
          <h2>Szenen</h2>
          <form [formGroup]="sceneForm" (ngSubmit)="saveScene()" class="auth-form">
            <label>
              Name
              <input formControlName="name">
            </label>
            <label>
              Beschreibung
              <input formControlName="description">
            </label>
            <label>
              Parent Szene ID
              <input formControlName="parentSceneId" type="number">
            </label>
            <label>
              Zugriff von
              <input formControlName="accessWindowStart" type="datetime-local">
            </label>
            <label>
              Zugriff bis
              <input formControlName="accessWindowEnd" type="datetime-local">
            </label>
            <label class="check-row">
              <input formControlName="active" type="checkbox">
              Aktiv
            </label>
            <button type="submit" [disabled]="busy() || sceneForm.invalid">Szene speichern</button>
          </form>

          <button type="button" (click)="loadScenes()" [disabled]="busy()">Szenen laden</button>
          <div class="admin-list">
            @for (scene of scenes(); track scene.id) {
              <article>
                <strong>{{ scene.name }}</strong>
                <span>ID {{ scene.id }} · {{ scene.active ? 'aktiv' : 'inaktiv' }}</span>
                @if (scene.parentSceneId) {
                  <span>Sub-Site von {{ scene.parentSceneId }}</span>
                }
                <div class="row-actions">
                  <button type="button" (click)="editScene(scene)">Bearbeiten</button>
                  <button type="button" (click)="deleteScene(scene.id)">Löschen</button>
                </div>
              </article>
            }
          </div>
        </section>

        <section class="admin-panel">
          <h2>Responder QR Codes</h2>
          <form [formGroup]="loginQrForm" (ngSubmit)="generateLoginQr()" class="auth-form">
            <label>
              Event Szene ID
              <input formControlName="eventSceneId" type="number">
            </label>
            <label>
              Anzahl
              <input formControlName="number" type="number">
            </label>
            <label>
              Gültig ab Login (Stunden)
              <input formControlName="expiresInHours" type="number">
            </label>
            <button type="submit" [disabled]="busy() || loginQrForm.invalid">Generieren</button>
          </form>
          <div class="row-actions">
            <button type="button" (click)="loadLoginQr()" [disabled]="busy()">Liste laden</button>
            <button type="button" (click)="print()">Drucken</button>
          </div>
          <div class="print-sheet">
            @for (code of loginQrCodes(); track code.id) {
              <article class="print-token">
                <strong>Responder QR</strong>
                <app-qr-code-image [token]="code.qrToken" label="Responder Login QR Code" />
                <span>{{ code.qrToken }}</span>
                <small>Event {{ code.eventSceneId }} · {{ code.expiresAt ? (code.expiresAt | date: 'short') : 'noch nicht aktiviert' }}</small>
                @if (!code.revokedAt) {
                  <button type="button" (click)="revokeLoginQr(code.id)">Widerrufen</button>
                }
              </article>
            }
          </div>
        </section>

        <section class="admin-panel">
          <h2>Patient QR Codes</h2>
          <form [formGroup]="patientQrForm" (ngSubmit)="generatePatientQr()" class="auth-form">
            <label>
              Anzahl
              <input formControlName="number" type="number">
            </label>
            <button type="submit" [disabled]="busy() || patientQrForm.invalid">Generieren</button>
          </form>
          <div class="row-actions">
            <button type="button" (click)="loadPatientQr()" [disabled]="busy()">Ungenutzte laden</button>
            <button type="button" (click)="print()">Drucken</button>
          </div>
          <div class="print-sheet">
            @for (token of patientQrCodes(); track token) {
              <article class="print-token">
                <strong>Patient QR</strong>
                <app-qr-code-image [token]="token" label="Patient QR Code" />
                <span>{{ token }}</span>
              </article>
            }
          </div>
        </section>

        <section class="admin-panel">
          <h2>Benutzer</h2>
          <form [formGroup]="userForm" (ngSubmit)="createUser()" class="auth-form">
            <label>
              Benutzername
              <input formControlName="username">
            </label>
            <label>
              Startpasswort
              <input formControlName="password" type="password">
            </label>
            <label>
              Rolle
              <select formControlName="role">
                <option value="admin">Admin</option>
                <option value="leitstelle">Leitstelle</option>
                <option value="responder">Responder</option>
              </select>
            </label>
            <label>
              Account Typ
              <select formControlName="accountType">
                <option value="permanent">Permanent</option>
                <option value="event">Event</option>
              </select>
            </label>
            <label>
              Event Szene ID
              <input formControlName="eventSceneId" type="number">
            </label>
            <button type="submit" [disabled]="busy() || userForm.invalid">Benutzer anlegen</button>
          </form>
          @if (createdUser(); as user) {
            <article class="admin-result">
              Angelegt: {{ user.username }} · ID {{ user.id }}
              <button type="button" (click)="revokeUser(user.id)">Zugang widerrufen</button>
            </article>
          }
          <a routerLink="/change-password">Eigenes Passwort ändern</a>
        </section>
      </div>
    </section>
  `,
})
export class AdminDashboard {
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly scenes = signal<OperationScene[]>([]);
  protected readonly loginQrCodes = signal<LoginQrCode[]>([]);
  protected readonly patientQrCodes = signal<string[]>([]);
  protected readonly createdUser = signal<components['schemas']['User'] | null>(null);

  private readonly api = inject(ApiClient);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly sceneForm = this.fb.group({
    id: [null as number | null],
    name: ['', Validators.required],
    description: [''],
    parentSceneId: [null as number | null],
    accessWindowStart: [''],
    accessWindowEnd: [''],
    active: [true],
  });

  protected readonly loginQrForm = this.fb.group({
    eventSceneId: [null as number | null, Validators.required],
    number: [10, [Validators.required, Validators.min(1), Validators.max(500)]],
    expiresInHours: [12, [Validators.required, Validators.min(1)]],
  });

  protected readonly patientQrForm = this.fb.group({
    number: [50, [Validators.required, Validators.min(1), Validators.max(1000)]],
  });

  protected readonly userForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['responder' as components['schemas']['Role'], Validators.required],
    accountType: ['permanent' as 'permanent' | 'event', Validators.required],
    eventSceneId: [null as number | null],
  });

  protected loadScenes(): void {
    this.run(() => this.api.listScenes().subscribe({
      next: (scenes) => this.done(() => this.scenes.set(scenes)),
      error: () => this.fail('Szenen konnten nicht geladen werden.'),
    }));
  }

  protected saveScene(): void {
    const raw = this.sceneForm.getRawValue();
    this.run(() => this.api.saveScene({
      id: raw.id ?? undefined,
      name: raw.name,
      description: raw.description || undefined,
      parentSceneId: raw.parentSceneId ?? undefined,
      accessWindowStart: toIso(raw.accessWindowStart),
      accessWindowEnd: toIso(raw.accessWindowEnd),
      active: raw.active,
    }).subscribe({
      next: (scene) => this.done(() => {
        this.upsertScene(scene);
        this.sceneForm.reset({ id: null, name: '', description: '', parentSceneId: null, accessWindowStart: '', accessWindowEnd: '', active: true });
      }, 'Szene gespeichert.'),
      error: () => this.fail('Szene konnte nicht gespeichert werden.'),
    }));
  }

  protected editScene(scene: OperationScene): void {
    this.sceneForm.setValue({
      id: scene.id,
      name: scene.name,
      description: scene.description ?? '',
      parentSceneId: scene.parentSceneId ?? null,
      accessWindowStart: toLocalInput(scene.accessWindowStart),
      accessWindowEnd: toLocalInput(scene.accessWindowEnd),
      active: scene.active,
    });
  }

  protected deleteScene(id: number): void {
    this.run(() => this.api.deleteScene(id).subscribe({
      next: () => this.done(() => this.scenes.update((scenes) => scenes.filter((scene) => scene.id !== id)), 'Szene gelöscht.'),
      error: () => this.fail('Szene konnte nicht gelöscht werden. Falls Patienten verknüpft sind, bitte deaktivieren.'),
    }));
  }

  protected generateLoginQr(): void {
    const raw = this.loginQrForm.getRawValue();
    this.run(() => this.api.generateLoginQrCodes({
      eventSceneId: Number(raw.eventSceneId),
      number: raw.number,
      expiresInHours: raw.expiresInHours,
    }).subscribe({
      next: (codes) => this.done(() => this.loginQrCodes.set(codes), 'Responder QR Codes generiert.'),
      error: () => this.fail('Responder QR Codes konnten nicht generiert werden.'),
    }));
  }

  protected loadLoginQr(): void {
    const eventSceneId = this.loginQrForm.controls.eventSceneId.value;
    this.run(() => this.api.listLoginQrCodes(eventSceneId ?? undefined).subscribe({
      next: (codes) => this.done(() => this.loginQrCodes.set(codes)),
      error: () => this.fail('Responder QR Codes konnten nicht geladen werden.'),
    }));
  }

  protected revokeLoginQr(id: number): void {
    this.run(() => this.api.revokeLoginQrCode(id).subscribe({
      next: () => this.done(() => this.loadLoginQr(), 'Responder QR Code widerrufen.'),
      error: () => this.fail('Responder QR Code konnte nicht widerrufen werden.'),
    }));
  }

  protected generatePatientQr(): void {
    this.run(() => this.api.generatePatientQrCodes(this.patientQrForm.getRawValue()).subscribe({
      next: (tokens) => this.done(() => this.patientQrCodes.set(tokens), 'Patient QR Codes generiert.'),
      error: () => this.fail('Patient QR Codes konnten nicht generiert werden.'),
    }));
  }

  protected loadPatientQr(): void {
    this.run(() => this.api.listUnusedPatientQrCodes().subscribe({
      next: (tokens) => this.done(() => this.patientQrCodes.set(tokens)),
      error: () => this.fail('Patient QR Codes konnten nicht geladen werden.'),
    }));
  }

  protected createUser(): void {
    const raw = this.userForm.getRawValue();
    this.run(() => this.api.createUser({
      username: raw.username,
      password: raw.password,
      role: raw.role,
      accountType: raw.accountType,
      eventSceneId: raw.eventSceneId ?? undefined,
    }).subscribe({
      next: (user) => this.done(() => this.createdUser.set(user), 'Benutzer angelegt.'),
      error: () => this.fail('Benutzer konnte nicht angelegt werden.'),
    }));
  }

  protected revokeUser(id: number): void {
    this.run(() => this.api.revokeUser(id).subscribe({
      next: () => this.done(undefined, 'Zugang widerrufen.'),
      error: () => this.fail('Zugang konnte nicht widerrufen werden.'),
    }));
  }

  protected print(): void {
    window.print();
  }

  private upsertScene(scene: OperationScene): void {
    this.scenes.update((scenes) => {
      const without = scenes.filter((item) => item.id !== scene.id);
      return [...without, scene].sort((a, b) => a.id - b.id);
    });
  }

  private run(action: () => void): void {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    action();
  }

  private done(update?: () => void, message = ''): void {
    update?.();
    this.busy.set(false);
    this.message.set(message);
  }

  private fail(message: string): void {
    this.busy.set(false);
    this.error.set(message);
  }
}

function toIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toLocalInput(value?: string | null): string {
  return value ? value.slice(0, 16) : '';
}
