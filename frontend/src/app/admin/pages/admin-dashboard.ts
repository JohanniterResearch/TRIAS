import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import QRCode from 'qrcode';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { PreviewModal } from '../components/preview-modal';
import { QrCodeImage } from '../components/qr-code-image';
import { QrPreviewModal, type QrPreviewItem } from '../components/qr-preview-modal';

type OperationScene = components['schemas']['OperationScene'];
type LoginQrCode = components['schemas']['LoginQrCode'];
type AdminUser = components['schemas']['User'];
type AdminPatient = components['schemas']['AdminPatient'];
type AdminPatientDetails = components['schemas']['AdminPatientDetails'];
type BodyRegions = { front: string[]; back: string[] };

@Component({
  selector: 'app-admin-dashboard',
  imports: [DatePipe, MyAccess, PreviewModal, QrCodeImage, QrPreviewModal, ReactiveFormsModule, RouterLink],
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
            <button type="button" (click)="patientQrPreviewOpen.set(true)">
              Vorschau anzeigen
            </button>
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

        <section class="admin-panel">
          <h2>Benutzer verwalten</h2>
          <form [formGroup]="userSearchForm" (ngSubmit)="searchManagedUsers()" class="auth-form">
            <label
              >Benutzername
              <input
                formControlName="search"
                list="managedUserOptions"
                (input)="suggestManagedUsers($event)"
              />
              <datalist id="managedUserOptions">
                @for (user of managedUserSuggestions(); track user.id) {
                  <option [value]="user.username"></option>
                }
              </datalist>
            </label>
            <label
              >Rolle
              <select formControlName="role">
                <option value="">Alle</option>
                <option value="responder">Responder</option>
                <option value="leitstelle">Leitstelle</option>
              </select></label
            >
            <label
              >Account Typ
              <select formControlName="accountType">
                <option value="">Alle</option>
                <option value="permanent">Permanent</option>
                <option value="event">Event</option>
              </select></label
            >
            <label
              >Status
              <select formControlName="status">
                <option value="">Alle</option>
                <option value="active">Aktiv</option>
                <option value="revoked">Widerrufen</option>
              </select></label
            >
            <button type="submit" [disabled]="busy()">Suchen</button>
          </form>
          <app-preview-modal
            title="Benutzer verwalten"
            [open]="userManagementOpen()"
            (close)="closeUserManagement()"
          >
            @if (managedUser(); as selected) {
              <button type="button" (click)="managedUser.set(null)">Zurück zur Suche</button>
              <form [formGroup]="managedUserForm" (ngSubmit)="saveManagedUser()" class="auth-form">
                <label>Benutzername <input formControlName="username" /></label>
                <label
                  >Rolle
                  <select formControlName="role">
                    <option value="responder">Responder</option>
                    <option value="leitstelle">Leitstelle</option>
                  </select></label
                >
                <label
                  >Account Typ
                  <select formControlName="accountType">
                    <option value="permanent">Permanent</option>
                    <option value="event">Event</option>
                  </select></label
                >
                <label>Event Szene ID <input type="number" formControlName="eventSceneId" /></label>
                <label
                  >Temporäres Passwort <input type="password" formControlName="temporaryPassword"
                /></label>
                <button type="submit" [disabled]="busy() || managedUserForm.invalid">
                  Änderungen speichern
                </button>
                <button
                  type="button"
                  (click)="resetManagedUser()"
                  [disabled]="busy() || managedUserForm.controls.temporaryPassword.invalid"
                >
                  Passwort zurücksetzen
                </button>
                @if (selected.revokedAt) {
                  <button
                    type="button"
                    (click)="reactivateManagedUser()"
                    [disabled]="busy() || managedUserForm.controls.temporaryPassword.invalid"
                  >
                    Reaktivieren
                  </button>
                }
              </form>
            } @else {
              <p class="qr-modal-count">{{ managedUsers().length }} Benutzer</p>
              <div class="admin-list">
                @for (user of managedUsers(); track user.id) {
                  <article>
                    <strong>{{ user.username }}</strong
                    ><span>{{ user.role }} · {{ user.accountType }}</span
                    ><button type="button" (click)="selectManagedUser(user)">Bearbeiten</button>
                  </article>
                }
              </div>
            }
          </app-preview-modal>
        </section>

        <section class="admin-panel">
          <h2>Patienten verwalten</h2>
          <form
            [formGroup]="patientSearchForm"
            (ngSubmit)="searchManagedPatients()"
            class="auth-form"
          >
            <label
              >Patientenkennung oder Name
              <input
                formControlName="search"
                list="managedPatientOptions"
                (input)="suggestManagedPatients($event)"
              />
              <datalist id="managedPatientOptions">
                @for (patient of managedPatientSuggestions(); track patient.editReference) {
                  @if (patient.humanReadableId || patient.name) {
                    <option [value]="patient.humanReadableId ?? patient.name"></option>
                  }
                }
              </datalist>
            </label>
            <label
              >Szene
              <select formControlName="operationSceneId" (focus)="ensureScenesLoaded()">
                <option [ngValue]="null">Alle</option>
                @for (scene of scenes(); track scene.id) {
                  <option [ngValue]="scene.id">{{ scene.name }} (ID {{ scene.id }})</option>
                }
              </select></label
            >
            <label
              >Status
              <select formControlName="status">
                <option value="">Alle</option>
                <option value="draft">Entwurf</option>
                <option value="finalized">Finalisiert</option>
              </select></label
            >
            <span class="disabled-submit" [title]="patientSearchDisabledReason()"
              ><button type="submit" [disabled]="busy() || patientSearchForm.invalid">
                Suchen
              </button></span
            >
          </form>
          <app-preview-modal
            title="Patienten verwalten"
            [open]="patientManagementOpen()"
            (close)="closePatientManagement()"
          >
            @if (managedPatient(); as selected) {
              <button type="button" (click)="closeManagedPatientDetails(); managedPatient.set(null)">Zurück zur Suche</button>
              @if (!managedPatientDetails()) {
                <button type="button" (click)="openManagedPatientDetails()">Weitere Patientendaten bearbeiten</button>
              }
              @if (managedPatientDetails(); as details) {
                <button type="button" (click)="closeManagedPatientDetails()">Zurück zur Kurzkorrektur</button>
                <form [formGroup]="managedPatientForm" (ngSubmit)="saveManagedPatient()" class="auth-form">
                  <h3>Stammdaten, Triage und Ort</h3>
                  <label>Name <input formControlName="name" /></label>
                  <label>Triage <select formControlName="triagefarbe"><option value="">–</option><option value="rot">Rot</option><option value="gelb">Gelb</option><option value="gruen">Grün</option><option value="schwarz">Schwarz</option></select></label>
                  <div class="body-map-columns">
                    <section>
                      @for (field of triageFieldsLeft; track field.key) {
                        <label class="check-row"><input type="checkbox" [formControlName]="field.key" />{{ field.label }}</label>
                      }
                    </section>
                    <section>
                      @for (field of triageFieldsRight; track field.key) {
                        <label class="check-row"><input type="checkbox" [formControlName]="field.key" />{{ field.label }}</label>
                      }
                    </section>
                  </div>
                  <label>Szene ID <input type="number" formControlName="operationSceneId" /></label>
                  <label>Breitengrad <input type="number" formControlName="latitudePatient" /></label>
                  <label>Längengrad <input type="number" formControlName="longitudePatient" /></label>
                  <label>Ortquelle <select formControlName="locationSource"><option value="">–</option><option value="gps">GPS</option><option value="manual">Manuell</option></select></label>
                  <label>Genauigkeit (m) <input type="number" min="0" formControlName="locationAccuracyMeters" /></label>
                  <label>Innenraum-Ort <input formControlName="indoorLocation" /></label>
                  <label>Begründung <input formControlName="correctionReason" /></label>
                  <button type="submit" [disabled]="busy() || managedPatientForm.invalid">Korrektur speichern</button>
                </form>
                <form [formGroup]="managedBodyPartsForm" (ngSubmit)="saveManagedBodyParts()" class="auth-form">
                  <h3>Körperkarte</h3>
                  <div class="body-map-columns">
                    <section><h4>Körper vorne</h4>@for (part of bodyRegions().front; track part) {<label class="check-row"><input type="checkbox" [checked]="details.bodyParts[part] === 1" (change)="setManagedBodyPart(part, $any($event.target).checked)" />{{ bodyPartLabel(part) }}</label>}</section>
                    <section><h4>Körper hinten</h4>@for (part of bodyRegions().back; track part) {<label class="check-row"><input type="checkbox" [checked]="details.bodyParts[part] === 1" (change)="setManagedBodyPart(part, $any($event.target).checked)" />{{ bodyPartLabel(part) }}</label>}</section>
                  </div>
                  <label>Begründung <input formControlName="correctionReason" /></label>
                  <button type="submit" [disabled]="busy() || managedBodyPartsForm.invalid">Körperkarte speichern</button>
                </form>
                <section class="auth-form">
                  <h3>Ambulanzblatt</h3>
                  @if (!protocolSummaryOpen()) {<button type="button" (click)="protocolSummaryOpen.set(true)">Ambulanzblatt anzeigen</button>} @else {
                    <button type="button" (click)="protocolSummaryOpen.set(false)">Zurück zu den Patientendaten</button>
                    @for (section of protocolSections(details.protocol); track section.title) { @if (section.entries.length) {<section><h4>{{ section.title }}</h4><dl>@for (entry of section.entries; track entry.label) {<dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd>}</dl></section>} }
                  }
                </section>
                <form [formGroup]="managedQrForm" (ngSubmit)="assignManagedPatientQr('existing')" class="auth-form">
                  <h3>Patienten-QR</h3><p>{{ details.qrCodeBound ? 'QR zugewiesen' : 'Kein QR zugewiesen' }}</p>
                  <label>Ungenutzter QR <select formControlName="qrReference"><option value="">Bitte wählen</option>@for (code of availablePatientQrCodes(); track code.reference) {<option [value]="code.reference">{{ code.label }}</option>}</select></label>
                  <button type="submit" [disabled]="busy() || managedQrForm.invalid">Ausgewählten QR zuweisen</button>
                  <button type="button" (click)="assignManagedPatientQr('new')" [disabled]="busy()">Neuen QR erzeugen und zuweisen</button>
                </form>
                @if (oneTimeQrToken()) {<section class="auth-form"><h3>Neuer Patienten-QR</h3><app-qr-code-image [token]="oneTimeQrToken()!" label="Patienten-QR" /><button type="button" (click)="printOneTimeQr()">Drucken</button><button type="button" (click)="closeOneTimeQrPreview()">Vorschau schließen</button></section>}
                <section><h3>Letzte Änderungen</h3><div class="admin-list">@for (entry of details.auditEntries; track entry.timestamp + entry.action) {<article><strong>{{ entry.action }}</strong><span>{{ entry.timestamp | date: 'short' }} · {{ entry.actorRole }}</span>@if (entry.reason) {<span>{{ entry.reason }}</span>}</article>}</div></section>
              } @else {
              <form
                [formGroup]="managedPatientForm"
                (ngSubmit)="saveManagedPatient()"
                class="auth-form"
              >
                <p>
                  {{ selected.humanReadableId ?? 'Unbenannter Patient' }} ·
                  {{ selected.protocolStatus }}
                </p>
                <label>Name <input formControlName="name" /></label>
                <label
                  >Triage
                  <select formControlName="triagefarbe">
                    <option value="">–</option>
                    <option value="rot">Rot</option>
                    <option value="gelb">Gelb</option>
                    <option value="gruen">Grün</option>
                    <option value="schwarz">Schwarz</option>
                  </select></label
                >
                <label>Szene ID <input type="number" formControlName="operationSceneId" /></label>
                <label
                  >Begründung für klinische Korrektur <input formControlName="correctionReason"
                /></label>
                <button type="submit" [disabled]="busy() || managedPatientForm.invalid">
                  Korrektur speichern
                </button>
              </form>
              }
            } @else {
              <p class="qr-modal-count">{{ managedPatients().length }} Patienten</p>
              <div class="admin-list">
                @for (patient of managedPatients(); track patient.editReference) {
                  <article>
                    <strong>{{ patient.humanReadableId ?? 'Unbenannter Patient' }}</strong
                    ><span>{{ patient.name ?? 'ohne Name' }} · {{ patient.protocolStatus }}</span
                    ><button type="button" (click)="selectManagedPatient(patient)">
                      Details / korrigieren
                    </button>
                  </article>
                }
              </div>
            }
          </app-preview-modal>
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
  protected readonly userManagementOpen = signal(false);
  protected readonly patientManagementOpen = signal(false);
  protected readonly managedUsers = signal<AdminUser[]>([]);
  protected readonly managedUserSuggestions = signal<AdminUser[]>([]);
  protected readonly managedUser = signal<AdminUser | null>(null);
  protected readonly managedPatients = signal<AdminPatient[]>([]);
  protected readonly managedPatientSuggestions = signal<AdminPatient[]>([]);
  protected readonly managedPatient = signal<AdminPatient | null>(null);
  protected readonly managedPatientDetails = signal<AdminPatientDetails | null>(null);
  protected readonly bodyRegions = signal<BodyRegions>({ front: [], back: [] });
  protected readonly availablePatientQrCodes = signal<components['schemas']['AvailablePatientQrCode'][]>([]);
  protected readonly protocolSummaryOpen = signal(false);
  protected readonly oneTimeQrToken = signal<string | null>(null);
  protected readonly triageFields = [
    { key: 'atmung', label: 'Atmung' }, { key: 'blutung', label: 'Blutung' },
    { key: 'radialispuls', label: 'Radialispuls' }, { key: 'transport', label: 'Transport' },
    { key: 'dringend', label: 'Dringend' }, { key: 'kontaminiert', label: 'Kontaminiert' },
  ] as const;
  protected readonly triageFieldsLeft = this.triageFields.slice(0, 3);
  protected readonly triageFieldsRight = this.triageFields.slice(3);

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

  protected readonly userSearchForm = this.fb.group({
    search: [''],
    role: ['' as '' | 'responder' | 'leitstelle'],
    accountType: ['' as '' | 'permanent' | 'event'],
    status: ['' as '' | 'active' | 'revoked'],
  });
  protected readonly managedUserForm = this.fb.group({
    username: ['', Validators.required],
    role: ['responder' as 'responder' | 'leitstelle', Validators.required],
    accountType: ['permanent' as 'permanent' | 'event', Validators.required],
    eventSceneId: [null as number | null],
    temporaryPassword: ['', Validators.minLength(8)],
  });
  protected readonly patientSearchForm = this.fb.group(
    {
      search: [''],
      operationSceneId: [null as number | null],
      status: ['' as '' | 'draft' | 'finalized'],
    },
    { validators: searchOrFilterRequired },
  );
  protected readonly managedPatientForm = this.fb.group({
    name: [''],
    triagefarbe: [''],
    operationSceneId: [null as number | null, Validators.required],
    correctionReason: [
      '',
      [Validators.required, Validators.minLength(1), Validators.maxLength(500)],
    ],
    atmung: [false], blutung: [false], radialispuls: [false], transport: [false], dringend: [false], kontaminiert: [false],
    latitudePatient: [null as number | null], longitudePatient: [null as number | null],
    locationSource: [''], locationAccuracyMeters: [null as number | null], indoorLocation: [''],
  });
  protected readonly managedBodyPartsForm = this.fb.group({ correctionReason: ['', [Validators.required, Validators.minLength(1), Validators.maxLength(500)]] });
  protected readonly managedQrForm = this.fb.group({ qrReference: ['', Validators.required] });

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

  protected searchManagedUsers(): void {
    const value = this.userSearchForm.getRawValue();
    this.managedUser.set(null);
    this.run(() =>
      this.api
        .adminUsers(value.search || undefined, value.role || undefined, value.accountType || undefined, value.status || undefined)
        .subscribe({
        next: (page) =>
          this.done(() => {
            this.managedUsers.set(page.items);
            this.userManagementOpen.set(true);
          }),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Benutzer konnten nicht geladen werden.')),
        }),
    );
  }

  protected suggestManagedUsers(event: Event): void {
    const search = (event.target as HTMLInputElement).value.trim();
    if (search.length < 2) {
      this.managedUserSuggestions.set([]);
      return;
    }
    const value = this.userSearchForm.getRawValue();
    this.api
      .adminUsers(search, value.role || undefined, value.accountType || undefined, value.status || undefined)
      .subscribe({
        next: (page) => {
          if ((event.target as HTMLInputElement).value.trim() === search)
            this.managedUserSuggestions.set(page.items);
        },
        error: () => this.managedUserSuggestions.set([]),
      });
  }

  protected closeUserManagement(): void {
    this.managedUser.set(null);
    this.userManagementOpen.set(false);
  }

  protected selectManagedUser(user: AdminUser): void {
    this.managedUser.set(user);
    this.userManagementOpen.set(true);
    this.managedUserForm.reset({
      username: user.username,
      role: user.role as 'responder' | 'leitstelle',
      accountType: user.accountType,
      eventSceneId: user.eventSceneId ?? null,
      temporaryPassword: '',
    });
  }

  protected saveManagedUser(): void {
    const user = this.managedUser();
    if (!user) return;
    const value = this.managedUserForm.getRawValue();
    this.run(() =>
      this.api
        .updateAdminUser(user.id, {
          username: value.username,
          role: value.role,
          accountType: value.accountType,
          eventSceneId: value.accountType === 'event' ? value.eventSceneId : null,
        })
        .subscribe({
          next: (updated) =>
            this.done(() => {
              this.managedUsers.update((items) =>
                items.map((item) => (item.id === updated.id ? updated : item)),
              );
              this.selectManagedUser(updated);
            }, 'Benutzer gespeichert.'),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Benutzer konnte nicht gespeichert werden.')),
        }),
    );
  }

  protected resetManagedUser(): void {
    this.setManagedPassword(false);
  }
  protected reactivateManagedUser(): void {
    this.setManagedPassword(true);
  }
  private setManagedPassword(reactivate: boolean): void {
    const user = this.managedUser();
    const password = this.managedUserForm.controls.temporaryPassword.value;
    if (!user || !password) return;
    this.run(() =>
      (reactivate
        ? this.api.reactivateAdminUser(user.id, password)
        : this.api.resetAdminUserPassword(user.id, password)
      ).subscribe({
        next: () =>
          this.done(
            () => this.searchManagedUsers(),
            reactivate ? 'Benutzer reaktiviert.' : 'Temporäres Passwort gesetzt.',
          ),
        error: (error: unknown) =>
          this.fail(apiErrorMessage(error, 'Aktion konnte nicht ausgeführt werden.')),
      }),
    );
  }

  protected searchManagedPatients(): void {
    const value = this.patientSearchForm.getRawValue();
    this.managedPatient.set(null);
    this.run(() =>
      this.api
        .adminPatients(value.search, value.operationSceneId ?? undefined, value.status || undefined)
        .subscribe({
          next: (page) =>
            this.done(() => {
              this.managedPatients.set(page.items);
              this.patientManagementOpen.set(true);
            }),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Patienten konnten nicht geladen werden.')),
        }),
    );
  }

  protected suggestManagedPatients(event: Event): void {
    const search = (event.target as HTMLInputElement).value.trim();
    if (search.length < 2 && !/^\d+$/.test(search)) {
      this.managedPatientSuggestions.set([]);
      return;
    }
    const value = this.patientSearchForm.getRawValue();
    this.api
      .adminPatients(search, value.operationSceneId ?? undefined, value.status || undefined)
      .subscribe({
        next: (page) => {
          if ((event.target as HTMLInputElement).value.trim() === search)
            this.managedPatientSuggestions.set(page.items);
        },
        error: () => this.managedPatientSuggestions.set([]),
      });
  }

  protected closePatientManagement(): void {
    this.closeManagedPatientDetails();
    this.managedPatient.set(null);
    this.patientManagementOpen.set(false);
  }

  protected selectManagedPatient(patient: AdminPatient): void {
    this.closeManagedPatientDetails();
    this.managedPatient.set(patient);
    this.patientManagementOpen.set(true);
    this.managedPatientForm.reset({
      name: patient.name ?? '',
      triagefarbe: patient.triagefarbe ?? '',
      operationSceneId: patient.operationSceneId,
      correctionReason: '',
      atmung: patient.atmung ?? false, blutung: patient.blutung ?? false, radialispuls: patient.radialispuls ?? false, transport: patient.transport ?? false, dringend: patient.dringend ?? false, kontaminiert: patient.kontaminiert ?? false,
      latitudePatient: patient.latitudePatient, longitudePatient: patient.longitudePatient,
      locationSource: patient.locationSource ?? '', locationAccuracyMeters: patient.locationAccuracyMeters, indoorLocation: patient.indoorLocation ?? '',
    });
  }

  protected openManagedPatientDetails(): void {
    const patient = this.managedPatient();
    if (!patient) return;
    this.run(() => this.api.adminPatientDetails(patient.editReference).subscribe({
      next: (details) => this.done(() => {
        this.managedPatientDetails.set(details);
        this.managedBodyPartsForm.reset({ correctionReason: '' });
        this.managedQrForm.reset({ qrReference: '' });
        this.protocolSummaryOpen.set(false);
        this.oneTimeQrToken.set(null);
        this.loadManagedBodyRegions();
        this.loadAvailablePatientQrCodes();
      }),
      error: (error: unknown) => this.fail(apiErrorMessage(error, 'Patientendaten konnten nicht geladen werden.')),
    }));
  }

  protected closeManagedPatientDetails(): void { this.managedPatientDetails.set(null); this.protocolSummaryOpen.set(false); this.oneTimeQrToken.set(null); }

  protected bodyPartLabel(key: string): string { return key.replaceAll('_', ' '); }

  protected setManagedBodyPart(key: string, selected: boolean): void {
    this.managedPatientDetails.update((details) => details ? { ...details, bodyParts: { ...details.bodyParts, [key]: selected ? 1 : 0 } } : details);
  }

  protected saveManagedBodyParts(): void {
    const patient = this.managedPatient(); const details = this.managedPatientDetails();
    if (!patient || !details) return;
    this.run(() => this.api.updateAdminPatientBodyParts(patient.editReference, { bodyParts: details.bodyParts, correctionReason: this.managedBodyPartsForm.controls.correctionReason.value! }).subscribe({
      next: (updated) => this.done(() => { this.managedPatientDetails.set(updated); this.managedBodyPartsForm.reset({ correctionReason: '' }); }, 'Körperkarte korrigiert.'),
      error: (error: unknown) => this.fail(apiErrorMessage(error, 'Körperkarte konnte nicht korrigiert werden.')),
    }));
  }

  protected protocolSections(protocol: AdminPatientDetails['protocol']): { title: string; entries: { label: string; value: string }[] }[] {
    const form = protocol.formState as Record<string, unknown>;
    const groups: [string, string[]][] = [
      ['Patientendaten', ['incident', 'patient']], ['Beurteilung', ['assessment_primary', 'assessment_secondary']],
      ['Vitalwerte', ['vitals']], ['Befunde', ['history']], ['Maßnahmen und Medikation', ['measures', 'medications_administered']],
      ['Disposition', ['disposition', 'signatures']], ['Abschluss', []],
    ];
    return groups.map(([title, keys]) => ({ title, entries: title === 'Abschluss'
      ? [{ label: 'Status', value: protocol.status === 'finalized' ? 'Finalisiert' : 'Entwurf' }, ...(protocol.finalizedAt ? [{ label: 'Finalisiert am', value: protocol.finalizedAt }] : [])]
      : (keys as string[]).flatMap((key) => this.protocolEntries(form[key], key)) }));
  }

  protected assignManagedPatientQr(source: 'existing' | 'new'): void {
    const patient = this.managedPatient(); const qrReference = this.managedQrForm.controls.qrReference.value;
    if (!patient || source === 'existing' && !qrReference) return;
    this.run(() => this.api.assignAdminPatientQrCode(patient.editReference, source === 'new' ? { source } : { source, qrReference }).subscribe({
      next: (result) => this.done(() => {
        this.managedPatients.update((items) => items.map((item) => item.editReference === result.patient.editReference ? result.patient : item));
        this.managedPatient.set(result.patient);
        this.managedPatientDetails.update((details) => details ? { ...details, patient: result.patient, qrCodeBound: true } : details);
        this.managedQrForm.reset({ qrReference: '' });
        this.oneTimeQrToken.set(result.printableQrToken ?? null);
        this.loadAvailablePatientQrCodes();
      }, 'QR-Code zugewiesen.'),
      error: (error: unknown) => this.fail(apiErrorMessage(error, 'QR-Code konnte nicht neu zugewiesen werden.')),
    }));
  }

  protected printOneTimeQr(): void { window.print(); }
  protected closeOneTimeQrPreview(): void { this.oneTimeQrToken.set(null); }

  private loadManagedBodyRegions(): void {
    if (this.bodyRegions().front.length || this.bodyRegions().back.length) return;
    fetch('/body-regions.json').then((response) => response.json()).then((regions: BodyRegions) => this.bodyRegions.set(regions)).catch(() => this.fail('Körperregionen konnten nicht geladen werden.'));
  }

  private loadAvailablePatientQrCodes(): void {
    this.api.availableAdminPatientQrCodes().subscribe({
      next: (page) => this.availablePatientQrCodes.set(page.items),
      error: (error: unknown) => this.fail(apiErrorMessage(error, 'Ungenutzte QR-Codes konnten nicht geladen werden.')),
    });
  }

  private protocolEntries(value: unknown, prefix: string): { label: string; value: string }[] {
    if (value == null || value === '' || value === false || Array.isArray(value) && value.length === 0) return [];
    if (Array.isArray(value)) return [{ label: this.bodyPartLabel(prefix), value: value.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join(', ') }];
    if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => this.protocolEntries(nested, `${prefix}.${key}`));
    return [{ label: this.bodyPartLabel(prefix.replaceAll('.', ' · ')), value: value === true ? 'Ja' : String(value) }];
  }

  protected saveManagedPatient(): void {
    const patient = this.managedPatient();
    if (!patient) return;
    const value = this.managedPatientForm.getRawValue();
    const triageUpdates = Object.fromEntries(
      this.triageFields
        .filter((field) => this.managedPatientForm.controls[field.key].dirty)
        .map((field) => [field.key, value[field.key]]),
    );
    this.run(() =>
      this.api
        .updateAdminPatient(patient.editReference, {
          name: value.name || null,
          triagefarbe: value.triagefarbe || null,
          operationSceneId: value.operationSceneId,
          correctionReason: value.correctionReason,
          ...triageUpdates,
          latitudePatient: value.latitudePatient, longitudePatient: value.longitudePatient, locationSource: value.locationSource || null, locationAccuracyMeters: value.locationAccuracyMeters, indoorLocation: value.indoorLocation || null,
        })
        .subscribe({
          next: (updated) =>
            this.done(() => {
              this.managedPatients.update((items) =>
                items.map((item) =>
                  item.editReference === updated.editReference ? updated : item,
                ),
              );
              this.selectManagedPatient(updated);
            }, 'Patient korrigiert.'),
          error: (error: unknown) =>
            this.fail(apiErrorMessage(error, 'Patient konnte nicht korrigiert werden.')),
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

  protected patientSearchDisabledReason(): string {
    return this.patientSearchForm.hasError('searchRequired')
      ? 'Bitte ID, Name, Szene oder Status angeben.'
      : this.busy()
        ? 'Aktion läuft.'
        : '';
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

function searchOrFilterRequired(control: AbstractControl): { searchRequired: true } | null {
  const value = control.value as {
    search?: string;
    operationSceneId?: number | null;
    status?: string;
  };
  return value.search?.trim() || value.operationSceneId || value.status
    ? null
    : { searchRequired: true };
}

function toLocalInput(value?: string | null): string {
  return value ? value.slice(0, 16) : '';
}
