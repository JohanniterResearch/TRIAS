import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import QRCode from 'qrcode';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { PreviewModal } from '../components/preview-modal';
import { QrPreviewModal, type QrPreviewItem } from '../components/qr-preview-modal';

type OperationScene = components['schemas']['OperationScene'];
type LoginQrCode = components['schemas']['LoginQrCode'];

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, MyAccess, PreviewModal, QrPreviewModal, ReactiveFormsModule, RouterLink],
  template: `
    <section class="admin-page">
      <app-my-access />
      <header>
        <h1>Administration</h1>
      </header>

      @if (message()) {
        <p class="status-message" role="status" aria-live="polite">{{ message() }}</p>
      }
      @if (error()) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
      }
      @if (busy()) {
        <p class="status-message" role="status" aria-live="polite">Aktion läuft.</p>
      }

      <div class="admin-grid">
        <section class="admin-panel">
          <h2>Szenen</h2>
          <form [formGroup]="sceneForm" (ngSubmit)="saveScene()" class="auth-form">
            <label>
              Name
              <input formControlName="name" />
            </label>
            <label>
              Beschreibung
              <input formControlName="description" />
            </label>
            <label>
              Parent Szene ID
              <input formControlName="parentSceneId" type="number" />
            </label>
            <label>
              Zugriff von
              <input formControlName="accessWindowStart" type="datetime-local" />
            </label>
            <label>
              Zugriff bis
              <input formControlName="accessWindowEnd" type="datetime-local" />
            </label>
            <label class="check-row">
              <input formControlName="active" type="checkbox" />
              Aktiv
            </label>
            <span class="disabled-submit" [title]="sceneDisabledReason()">
              <button type="submit" [disabled]="busy() || sceneForm.invalid">
                Szene speichern
              </button>
            </span>
          </form>

          <div class="row-actions">
            <button type="button" (click)="loadScenes()" [disabled]="busy()">Szenen laden</button>
            <button type="button" (click)="scenesPreviewOpen.set(true)">Vorschau anzeigen</button>
          </div>
          <app-preview-modal
            title="Szenen Vorschau"
            [open]="scenesPreviewOpen()"
            (close)="scenesPreviewOpen.set(false)"
          >
            <p class="qr-modal-count">{{ scenes().length }} Szene(n)</p>
            <div class="admin-list">
              @for (scene of scenes(); track scene.id) {
                <article>
                  <strong>{{ scene.name }}</strong>
                  <span>ID {{ scene.id }} · {{ scene.active ? 'aktiv' : 'inaktiv' }}</span>
                  @if (scene.parentSceneId) {
                    <span>Sub-Site von {{ scene.parentSceneId }}</span>
                  }
                  <div class="row-actions">
                    <button type="button" (click)="editScene(scene); scenesPreviewOpen.set(false)">
                      Bearbeiten
                    </button>
                    <button type="button" (click)="deleteScene(scene.id)">Löschen</button>
                  </div>
                </article>
              }
            </div>
          </app-preview-modal>
        </section>

        <section class="admin-panel">
          <h2>Responder QR Codes</h2>
          <form [formGroup]="loginQrForm" (ngSubmit)="generateLoginQr()" class="auth-form">
            <label>
              Event Szene ID
              <input formControlName="eventSceneId" type="number" />
            </label>
            <label>
              Anzahl
              <input formControlName="number" type="number" />
            </label>
            <label>
              Gültig ab Login (Stunden)
              <input formControlName="expiresInHours" type="number" />
            </label>
            <span class="disabled-submit" [title]="loginQrDisabledReason()">
              <button type="submit" [disabled]="busy() || loginQrForm.invalid">Generieren</button>
            </span>
          </form>
          <div class="row-actions">
            <button type="button" (click)="loadLoginQr()" [disabled]="busy()">Liste laden</button>
            <button type="button" (click)="loginQrPreviewOpen.set(true)">Vorschau anzeigen</button>
            <button type="button" (click)="printResponderQr()">Drucken</button>
          </div>
          <app-qr-preview-modal
            [items]="loginQrPreviewItems()"
            [open]="loginQrPreviewOpen()"
            (close)="loginQrPreviewOpen.set(false)"
          />
        </section>

        <section class="admin-panel">
          <h2>Patient QR Codes</h2>
          <form [formGroup]="patientQrForm" (ngSubmit)="generatePatientQr()" class="auth-form">
            <label>
              Anzahl
              <input formControlName="number" type="number" />
            </label>
            <button
              type="submit"
              [disabled]="busy() || patientQrForm.invalid"
              [title]="patientQrDisabledReason()"
            >
              Generieren
            </button>
          </form>
          <div class="row-actions">
            <button type="button" (click)="loadPatientQr()" [disabled]="busy()">
              Ungenutzte laden
            </button>
            <button type="button" (click)="patientQrPreviewOpen.set(true)">Vorschau anzeigen</button>
            <button type="button" (click)="printPatientQr()">Drucken</button>
          </div>
          <app-qr-preview-modal
            [items]="patientQrPreviewItems()"
            [open]="patientQrPreviewOpen()"
            (close)="patientQrPreviewOpen.set(false)"
          />
        </section>

        <section class="admin-panel">
          <h2>Benutzer</h2>
          <form [formGroup]="userForm" (ngSubmit)="createUser()" class="auth-form">
            <label>
              Benutzername
              <input formControlName="username" />
            </label>
            <label>
              Startpasswort
              <input formControlName="password" type="password" />
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
              <input formControlName="eventSceneId" type="number" />
            </label>
            <label>
              Szene suchen
              <span class="input-with-button">
                <input
                  #sceneSearch
                  type="text"
                  list="eventSceneOptions"
                  (focus)="ensureScenesLoaded()"
                  (input)="selectEventScene($event)"
                  placeholder="Name eingeben…"
                />
                <button
                  type="button"
                  class="input-inline-button"
                  aria-label="Szenen durchsuchen"
                  (click)="ensureScenesLoaded(); sceneSearch.focus()"
                >
                  🔍
                </button>
              </span>
              <datalist id="eventSceneOptions">
                @for (scene of scenes(); track scene.id) {
                  <option [value]="scene.name + ' (ID ' + scene.id + ')'"></option>
                }
              </datalist>
            </label>
            <span class="disabled-submit" [title]="userDisabledReason()">
              <button type="submit" [disabled]="busy() || userForm.invalid">
                Benutzer anlegen
              </button>
            </span>
          </form>
          @if (createdUser(); as user) {
            <article class="admin-result">
              Angelegt: {{ user.username }} · ID {{ user.id }}
              <button type="button" (click)="revokeUser(user.id)">Zugang widerrufen</button>
            </article>
          }
          <div class="row-actions">
            <button type="button" (click)="loadUsers()" [disabled]="busy()">Benutzer laden</button>
            <button type="button" (click)="usersPreviewOpen.set(true)">Vorschau anzeigen</button>
          </div>
          <app-preview-modal
            title="Benutzer Vorschau"
            [open]="usersPreviewOpen()"
            (close)="usersPreviewOpen.set(false)"
          >
            <p class="qr-modal-count">{{ users().length }} Benutzer</p>
            <div class="admin-list">
              @for (user of users(); track user.id) {
                <article>
                  <strong>{{ user.username }}</strong>
                  <span>{{ user.role }} · {{ user.accountType }}</span>
                  @if (user.revokedAt) {
                    <span>Widerrufen: {{ user.revokedAt | date: 'short' }}</span>
                  } @else {
                    <button type="button" (click)="revokeUser(user.id)">Zugang widerrufen</button>
                  }
                </article>
              }
            </div>
          </app-preview-modal>
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
  protected readonly users = signal<components['schemas']['User'][]>([]);
  protected readonly createdUser = signal<components['schemas']['User'] | null>(null);
  protected readonly loginQrPreviewOpen = signal(false);
  protected readonly patientQrPreviewOpen = signal(false);
  protected readonly scenesPreviewOpen = signal(false);
  protected readonly usersPreviewOpen = signal(false);

  // Derived straight from the data signals (not a snapshot taken on click), so the
  // preview always matches whatever loadLoginQr/loadPatientQr/generate*Qr last set,
  // regardless of which action or panel triggered the update.
  protected readonly loginQrPreviewItems = computed<QrPreviewItem[]>(() =>
    this.loginQrCodes().map((code) => ({
      token: code.qrToken,
      label: `Responder QR · Event ${code.eventSceneId}`,
    })),
  );
  protected readonly patientQrPreviewItems = computed<QrPreviewItem[]>(() =>
    this.patientQrCodes().map((token) => ({ token, label: 'Patient QR' })),
  );

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

  protected readonly userForm = this.fb.group(
    {
      username: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]],
      role: ['responder' as components['schemas']['Role'], Validators.required],
      accountType: ['permanent' as 'permanent' | 'event', Validators.required],
      eventSceneId: [null as number | null],
    },
    { validators: eventAccountNeedsScene },
  );

  protected loadScenes(): void {
    this.run(() =>
      this.api.listScenes().subscribe({
        next: (scenes) =>
          this.done(() => {
            this.scenes.set(scenes);
            this.scenesPreviewOpen.set(true);
          }),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Szenen konnten nicht geladen werden.')),
      }),
    );
  }

  protected saveScene(): void {
    const raw = this.sceneForm.getRawValue();
    this.run(() =>
      this.api
        .saveScene({
          id: raw.id ?? undefined,
          name: raw.name,
          description: raw.description || undefined,
          parentSceneId: raw.parentSceneId ?? undefined,
          accessWindowStart: toIso(raw.accessWindowStart),
          accessWindowEnd: toIso(raw.accessWindowEnd),
          active: raw.active,
        })
        .subscribe({
          next: (scene) =>
            this.done(() => {
              this.upsertScene(scene);
              this.sceneForm.reset({
                id: null,
                name: '',
                description: '',
                parentSceneId: null,
                accessWindowStart: '',
                accessWindowEnd: '',
                active: true,
              });
            }, 'Szene gespeichert.'),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Szene konnte nicht gespeichert werden.')),
        }),
    );
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
    this.run(() =>
      this.api.deleteScene(id).subscribe({
        next: () =>
          this.done(
            () => this.scenes.update((scenes) => scenes.filter((scene) => scene.id !== id)),
            'Szene gelöscht.',
          ),
        error: (error: unknown) =>
          this.fail(
            apiErrorMessage(
              error,
              'Szene konnte nicht gelöscht werden. Falls Patienten verknüpft sind, bitte deaktivieren.',
            ),
          ),
      }),
    );
  }

  protected generateLoginQr(): void {
    const raw = this.loginQrForm.getRawValue();
    this.run(() =>
      this.api
        .generateLoginQrCodes({
          eventSceneId: Number(raw.eventSceneId),
          number: raw.number,
          expiresInHours: raw.expiresInHours,
        })
        .subscribe({
          next: (codes) =>
            this.done(() => this.loginQrCodes.set(codes), 'Responder QR Codes generiert.'),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Responder QR Codes konnten nicht generiert werden.')),
        }),
    );
  }

  protected loadLoginQr(): void {
    const eventSceneId = this.loginQrForm.controls.eventSceneId.value;
    this.run(() =>
      this.api.listLoginQrCodes(eventSceneId ?? undefined).subscribe({
        next: (codes) =>
          this.done(() => {
            this.loginQrCodes.set(codes);
            this.loginQrPreviewOpen.set(true);
          }),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Responder QR Codes konnten nicht geladen werden.')),
      }),
    );
  }

  protected revokeLoginQr(id: number): void {
    this.run(() =>
      this.api.revokeLoginQrCode(id).subscribe({
        next: () => this.done(() => this.loadLoginQr(), 'Responder QR Code widerrufen.'),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Responder QR Code konnte nicht widerrufen werden.')),
      }),
    );
  }

  protected generatePatientQr(): void {
    this.run(() =>
      this.api.generatePatientQrCodes(this.patientQrForm.getRawValue()).subscribe({
        next: (tokens) =>
          this.done(() => this.patientQrCodes.set(tokens), 'Patient QR Codes generiert.'),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Patient QR Codes konnten nicht generiert werden.')),
      }),
    );
  }

  protected loadPatientQr(): void {
    this.run(() =>
      this.api.listUnusedPatientQrCodes().subscribe({
        next: (tokens) =>
          this.done(() => {
            this.patientQrCodes.set(tokens);
            this.patientQrPreviewOpen.set(true);
          }),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Patient QR Codes konnten nicht geladen werden.')),
      }),
    );
  }

  // Loads the scene list lazily the first time the picker is opened, so the admin
  // sees names instead of having to remember scene IDs.
  protected ensureScenesLoaded(): void {
    if (this.scenes().length > 0 || this.busy()) return;
    this.run(() =>
      this.api.listScenes().subscribe({
        next: (scenes) => this.done(() => this.scenes.set(scenes)),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Szenen konnten nicht geladen werden.')),
      }),
    );
  }

  // Datalist options render as "Name (ID 3)"; only act once the typed text matches
  // one of those exactly, so free-form typing doesn't clobber the field mid-keystroke.
  protected selectEventScene(event: Event): void {
    const match = /\(ID (\d+)\)$/.exec((event.target as HTMLInputElement).value);
    if (match) this.userForm.controls.eventSceneId.setValue(Number(match[1]));
  }

  protected createUser(): void {
    const raw = this.userForm.getRawValue();
    this.run(() =>
      this.api
        .createUser({
          username: raw.username,
          password: raw.password,
          role: raw.role,
          accountType: raw.accountType,
          eventSceneId: raw.eventSceneId ?? undefined,
        })
        .subscribe({
          next: (user) =>
            this.done(() => {
              this.createdUser.set(user);
              this.upsertUser(user);
            }, 'Benutzer angelegt.'),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Benutzer konnte nicht angelegt werden.')),
        }),
    );
  }

  protected revokeUser(id: number): void {
    this.run(() =>
      this.api.revokeUser(id).subscribe({
        next: () => this.done(() => this.loadUsers(), 'Zugang widerrufen.'),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Zugang konnte nicht widerrufen werden.')),
      }),
    );
  }

  protected loadUsers(): void {
    this.run(() =>
      this.api.listUsers().subscribe({
        next: (users) =>
          this.done(() => {
            this.users.set(users);
            this.usersPreviewOpen.set(true);
          }),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Benutzer konnten nicht geladen werden.')),
      }),
    );
  }

  protected sceneDisabledReason(): string {
    if (this.busy()) return 'Aktion läuft.';
    if (this.sceneForm.controls.name.hasError('required'))
      return 'Name fehlt. Bitte einen Namen eingeben.';
    return '';
  }

  protected loginQrDisabledReason(): string {
    if (this.busy()) return 'Aktion läuft.';
    if (this.loginQrForm.controls.eventSceneId.hasError('required'))
      return 'Event-Szene-ID fehlt. Bitte eine gültige ID eingeben.';
    if (this.loginQrForm.controls.number.hasError('required'))
      return 'Anzahl fehlt. Bitte eine Zahl von 1 bis 500 eingeben.';
    if (
      this.loginQrForm.controls.number.hasError('min') ||
      this.loginQrForm.controls.number.hasError('max')
    )
      return 'Anzahl muss zwischen 1 und 500 liegen. Bitte den Wert anpassen.';
    if (
      this.loginQrForm.controls.expiresInHours.hasError('required') ||
      this.loginQrForm.controls.expiresInHours.hasError('min')
    )
      return 'Gültigkeitsdauer fehlt. Bitte mindestens 1 Stunde eingeben.';
    return '';
  }

  protected patientQrDisabledReason(): string {
    if (this.busy()) return 'Aktion läuft.';
    if (this.patientQrForm.controls.number.hasError('required'))
      return 'Anzahl fehlt. Bitte eine Zahl von 1 bis 1.000 eingeben.';
    if (
      this.patientQrForm.controls.number.hasError('min') ||
      this.patientQrForm.controls.number.hasError('max')
    )
      return 'Anzahl muss zwischen 1 und 1.000 liegen. Bitte den Wert anpassen.';
    return '';
  }

  protected userDisabledReason(): string {
    if (this.busy()) return 'Aktion läuft.';
    if (this.userForm.controls.username.hasError('required'))
      return 'Benutzername fehlt. Bitte einen Namen eingeben.';
    if (
      this.userForm.controls.password.hasError('required') ||
      this.userForm.controls.password.hasError('minlength')
    )
      return 'Startpasswort muss mindestens 8 Zeichen haben. Bitte ergänzen.';
    if (this.userForm.hasError('eventSceneRequired'))
      return 'Event-Szene-ID für Event-Account fehlt. Bitte eine Event-Szene auswählen, eine ID eingeben oder als Permanenten Account anlegen.';
    return '';
  }

  protected printResponderQr(): void {
    this.printQrCodes(
      this.loginQrCodes().map((code) => ({
        token: code.qrToken,
        caption: `Responder QR · Event ${code.eventSceneId}`,
      })),
    );
  }

  protected printPatientQr(): void {
    this.printQrCodes(this.patientQrCodes().map((token) => ({ token, caption: 'Patient QR' })));
  }

  // Prints QR codes in isolation: opens a dedicated blank window and fills it with
  // only the QR images and their SHA-256 hashes, so window.print() never picks up
  // the rest of the admin page. The window is opened synchronously (before any
  // await) so browsers still treat it as user-gesture-triggered.
  private printQrCodes(items: { token: string; caption: string }[]): void {
    const win = window.open('', '_blank');
    if (!win) {
      this.fail('Druckfenster konnte nicht geöffnet werden.');
      return;
    }
    void this.renderQrPrintWindow(win, items);
  }

  private async renderQrPrintWindow(
    win: Window,
    items: { token: string; caption: string }[],
  ): Promise<void> {
    const cards = await Promise.all(
      items.map(async ({ token, caption }) => {
        const [qr, hash] = await Promise.all([
          QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 4, width: 320 }),
          sha256Hex(token),
        ]);
        return `<article><img src="${qr}" alt="${caption}" /><p>${caption}</p><code>${hash}</code></article>`;
      }),
    );

    win.document.write(`<!doctype html>
<html>
<head>
<title>QR Codes</title>
<style>
  body { font-family: sans-serif; margin: 1rem; }
  .print-grid { display: grid; gap: 1rem; grid-template-columns: repeat(2, 1fr); }
  article { border: 1px solid #d7dde5; border-radius: 0.35rem; padding: 0.75rem; text-align: center; }
  img { max-width: 15rem; width: 100%; }
  code { display: block; font-size: 0.7rem; overflow-wrap: anywhere; }
</style>
</head>
<body>
<div class="print-grid">${cards.join('')}</div>
</body>
</html>`);
    win.document.close();
    win.onload = () => {
      win.print();
      win.close();
    };
  }

  private upsertScene(scene: OperationScene): void {
    this.scenes.update((scenes) => {
      const without = scenes.filter((item) => item.id !== scene.id);
      return [...without, scene].sort((a, b) => a.id - b.id);
    });
  }

  private upsertUser(user: components['schemas']['User']): void {
    this.users.update((users) =>
      [...users.filter((item) => item.id !== user.id), user].sort((a, b) => a.id - b.id),
    );
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function toIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function eventAccountNeedsScene(control: AbstractControl): { eventSceneRequired: true } | null {
  const { accountType, eventSceneId } = control.value as {
    accountType?: string;
    eventSceneId?: number | null;
  };
  return accountType === 'event' && !Number.isInteger(eventSceneId)
    ? { eventSceneRequired: true }
    : null;
}

function toLocalInput(value?: string | null): string {
  return value ? value.slice(0, 16) : '';
}
