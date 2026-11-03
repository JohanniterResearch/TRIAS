import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ResponderStateStore } from '../responder/services/responder-state';
import { ThemePreferenceService } from '../theme/theme-preference.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  styleUrl: './home.css',
  template: `
    <section class="home" [class.theme-dark]="theme.darkMode()">
      <div class="home-main">
        @if (state.patient(); as patient) {
          <section class="patient-card" aria-label="Aktueller Patient">
            <div class="patient-summary">
              <span class="patient-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle cx="9.5" cy="6.5" r="3.5"></circle>
                  <path d="M2.5 21v-2a7 7 0 0 1 14 0v2zM19 8v6m-3-3h6"></path>
                </svg>
              </span>
              <div>
                <span class="patient-kicker">Aktueller Patient</span>
                <strong>{{ patient.name || patient.humanReadableId || 'Patient' }}</strong>
                <span class="patient-id">Kennung {{ patient.humanReadableId || patient.id }}</span>
              </div>
            </div>
          </section>
        }

        <nav class="tile-grid login-grid" aria-label="Anmeldung">
          <a class="menu-tile login-link" routerLink="/login" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M8 8h20v20H8zm28 0h20v20H36zM8 36h20v20H8z"></path>
              <path
                d="M14 14h8v8h-8zm28 0h8v8h-8zM14 42h8v8h-8zM36 36h8v8h-8zm12 0h8v8h-8zm-12 12h8v8h-8zm12 0h8v8h-8z"
              ></path>
            </svg>
            <span class="tile-label">QR Login</span>
          </a>
          <a class="menu-tile login-link" routerLink="/admin/login" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="14" y="28" width="36" height="28" rx="2"></rect>
              <path d="M22 28v-8a10 10 0 0 1 20 0v8m-10 12v6"></path>
            </svg>
            <span class="tile-label">Admin Login</span>
          </a>
        </nav>

        <nav class="tile-grid feature-grid" aria-label="Bereiche">
          <a class="menu-tile feature-link triage" routerLink="/triage" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M32 8 56 52H8L32 8Z"></path>
              <path d="M32 24v13m0 7v1"></path>
            </svg>
            <span class="feature-copy">
              <strong>Triage</strong>
              <span>Patienten priorisieren</span>
            </span>
          </a>

          <a class="menu-tile feature-link scan" routerLink="/scan-patient" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M10 24V10h14m16 0h14v14M54 40v14H40M24 54H10V40"></path>
              <path d="M20 24h7v7h-7zm17 0h7v7h-7zm-17 16h7v-7h-7zm17-2v-3h7v7h-3"></path>
            </svg>
            <span class="feature-copy">
              <strong>Patient aufnehmen</strong>
              <span>QR-Code scannen oder wählen</span>
            </span>
          </a>

          <a
            class="menu-tile feature-link protocol"
            [routerLink]="protocolRoute()"
            (click)="vibrate()"
          >
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M18 8h20l12 12v36H18z"></path>
              <path d="M38 8v14h12M26 34h16m-16 9h16"></path>
            </svg>
            <span class="feature-copy">
              <strong>Ambulanzprotokoll</strong>
              <span>{{
                state.patient() ? 'Aktuellen Patienten öffnen' : 'Patient auswählen'
              }}</span>
            </span>
          </a>

          <a
            class="menu-tile feature-link situation"
            routerLink="/situation-room"
            (click)="vibrate()"
          >
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="m8 14 16-6 16 6 16-6v42l-16 6-16-6-16 6z"></path>
              <path d="M24 8v42m16-36v42"></path>
              <path
                d="M17 25a4 4 0 1 0 8 0c0-2.2-4-7-4-7s-4 4.8-4 7Zm20 12a4 4 0 1 0 8 0c0-2.2-4-7-4-7s-4 4.8-4 7Z"
              ></path>
            </svg>
            <span class="feature-copy">
              <strong>Lagebild</strong>
              <span>Überblick zum Einsatz</span>
            </span>
          </a>

          <a class="menu-tile feature-link teams" routerLink="/teams" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="24" cy="21" r="8"></circle>
              <circle cx="44" cy="25" r="6"></circle>
              <path d="M8 53v-5a16 16 0 0 1 32 0v5m4-16a12 12 0 0 1 12 12v4"></path>
            </svg>
            <span class="feature-copy">
              <strong>Teams</strong>
              <span>Einheiten koordinieren</span>
            </span>
          </a>

          <a
            class="menu-tile feature-link role-selection"
            routerLink="/role-selection"
            (click)="vibrate()"
          >
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M12 14h40v40H12zM22 26l7 7 14-15M22 44h20"></path>
            </svg>
            <span class="tile-label">Einsatz wählen</span>
          </a>

          <a class="menu-tile feature-link body-front" routerLink="/body/front" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="12" r="7"></circle>
              <path d="M22 24h20l5 18h-8v14H25V42h-8zM22 24l-7 16m27-16 7 16"></path>
            </svg>
            <span class="tile-label">Körper vorne</span>
          </a>
          <a class="menu-tile feature-link body-back" routerLink="/body/back" (click)="vibrate()">
            <svg class="tile-icon" viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="12" r="7"></circle>
              <path d="M22 24h20l5 18h-8v14H25V42h-8zM22 24l-7 16m27-16 7 16M32 24v30"></path>
            </svg>
            <span class="tile-label">Körper hinten</span>
          </a>
          <a class="menu-tile feature-link" routerLink="/admin" (click)="vibrate()">
            <svg class="tile-icon" viewBox="-4 -4 72 72" aria-hidden="true">
              <path
                d="M27 6h10l2 7 5 2 6-4 7 7-4 6 2 5 7 2v10l-7 2-2 5 4 6-7 7-6-4-5 2-2 7H27l-2-7-5-2-6 4-7-7 4-6-2-5-7-2V31l7-2 2-5-4-6 7-7 6 4 5-2z"
              ></path>
              <circle cx="32" cy="32" r="8"></circle>
            </svg>
            <span class="tile-label">Admin</span>
          </a>
        </nav>
      </div>
    </section>
  `,
})
export class Home {
  protected readonly state = inject(ResponderStateStore);
  protected readonly theme = inject(ThemePreferenceService);

  protected protocolRoute(): string {
    const patient = this.state.patient();
    return patient ? `/ambulanzprotokoll/${patient.id}` : '/scan-patient';
  }

  protected vibrate(): void {
    if ('vibrate' in navigator) {
      navigator.vibrate?.(12);
    }
  }
}
