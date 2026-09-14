import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';
import { homeRouteForToken } from '../auth.rules';
import { DevAccess } from '../components/dev-access';

@Component({
  selector: 'app-admin-login-page',
  imports: [DevAccess, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <p class="eyebrow">Admin / Leitstelle</p>
      <h1>Anmelden</h1>

      @if (error) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error }}</p>
      }
      @if (busy) {
        <p class="status-message" role="status" aria-live="polite">Anmeldung läuft.</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
        <label>
          Benutzername
          <input formControlName="username" autocomplete="username" autofocus />
        </label>
        <label>
          Passwort
          <input formControlName="password" type="password" autocomplete="current-password" />
        </label>
        <button type="submit" [disabled]="busy || form.invalid">Einloggen</button>
      </form>

      <nav class="auth-links">
        <a routerLink="/login">Responder QR Login</a>
      </nav>

      <app-dev-access role="admin" />
    </section>
  `,
})
export class AdminLoginPage {
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected busy = false;
  protected error = '';

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected submit(): void {
    this.busy = true;
    this.error = '';
    const credentials = this.form.getRawValue();

    this.api.adminLogin(credentials).subscribe({
      next: (result) => {
        if (result.role !== 'admin' && result.role !== 'leitstelle') {
          this.busy = false;
          this.error = 'Dieser Zugang ist kein Admin- oder Leitstellenzugang.';
          return;
        }

        const expired = this.auth.activeSession();
        if (expired?.expired && expired.username !== credentials.username) {
          this.busy = false;
          this.error = 'Die abgelaufene Sitzung muss mit demselben Benutzer fortgesetzt werden.';
          return;
        }

        this.auth.setAdminSession({
          token: result.token,
          refreshToken: result.refreshToken,
          tokenType: result.role,
          username: credentials.username,
          requiresPasswordChange: result.requiresPasswordChange,
        });
        this.router.navigateByUrl(homeRouteForToken(result.role, result.requiresPasswordChange));
      },
      error: () => {
        this.busy = false;
        this.error = 'Benutzername oder Passwort ist ungültig.';
      },
    });
  }
}
