import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';

@Component({
  selector: 'app-change-password-page',
  imports: [ReactiveFormsModule],
  template: `
    <section class="auth-page">
      <p class="eyebrow">Passwort ändern</p>
      <h1>Neues Passwort setzen</h1>

      @if (error) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error }}</p>
      }
      @if (busy) {
        <p class="status-message" role="status" aria-live="polite">Passwort wird geändert.</p>
      }

      <form [formGroup]="form" (ngSubmit)="submit()" class="auth-form">
        <label>
          Benutzername
          <input formControlName="username" autocomplete="username" />
        </label>
        <label>
          Aktuelles Passwort
          <input formControlName="password" type="password" autocomplete="current-password" />
        </label>
        <label>
          Neues Passwort
          <input formControlName="newPassword" type="password" autocomplete="new-password" />
        </label>
        <button type="submit" [disabled]="busy || form.invalid">Passwort ändern</button>
      </form>
    </section>
  `,
})
export class ChangePasswordPage {
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: [inject(AuthStore).activeSession()?.username ?? '', Validators.required],
    password: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected busy = false;
  protected error = '';

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected submit(): void {
    this.busy = true;
    this.error = '';
    this.api.changePassword(this.form.getRawValue()).subscribe({
      next: () => {
        this.auth.clear();
        this.router.navigateByUrl('/admin/login');
      },
      error: (error: unknown) => {
        this.busy = false;
        this.error = apiErrorMessage(error, 'Passwort konnte nicht geändert werden.');
      },
    });
  }
}
