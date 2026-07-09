import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { environment } from '../../../environments/environment';
import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';

@Component({
  selector: 'app-admin-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <p class="eyebrow">Admin / Leitstelle</p>
      <h1>Anmelden</h1>

      @if (error) {
        <p class="form-error">{{ error }}</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
        <label>
          Benutzername
          <input formControlName="username" autocomplete="username" autofocus>
        </label>
        <label>
          Passwort
          <input formControlName="password" type="password" autocomplete="current-password">
        </label>
        <button type="submit" [disabled]="busy || form.invalid">Einloggen</button>
      </form>

      <nav class="auth-links">
        <a routerLink="/login">Responder QR Login</a>
      </nav>

      @if (environment.enableDevButtons) {
        <button type="button" class="dev-button" (click)="devLogin()">DEV Admin</button>
      }
    </section>
  `,
})
export class AdminLoginPage {
  protected readonly environment = environment;
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

        this.auth.setAdminSession({
          token: result.token,
          refreshToken: result.refreshToken,
          tokenType: result.role,
          username: credentials.username,
        });
        this.router.navigateByUrl(result.requiresPasswordChange ? '/change-password' : '/admin');
      },
      error: () => {
        this.busy = false;
        this.error = 'Benutzername oder Passwort ist ungültig.';
      },
    });
  }

  protected devLogin(): void {
    this.busy = true;
    this.error = '';
    this.api.devLogin('admin').subscribe({
      next: (result) => {
        this.auth.setAdminSession({ token: result.token, refreshToken: result.refreshToken, tokenType: 'admin', username: 'DEV' });
        this.router.navigateByUrl('/admin');
      },
      error: () => {
        this.busy = false;
        this.error = 'DEV Login ist nicht verfügbar.';
      },
    });
  }
}
