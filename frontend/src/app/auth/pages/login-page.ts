import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { QrScanner } from '../../shared/qr-scanner';
import { AuthStore } from '../auth.store';
import { DevAccess } from '../components/dev-access';

@Component({
  selector: 'app-login-page',
  imports: [DevAccess, QrScanner, ReactiveFormsModule, RouterLink],
  template: `
    <section class="auth-page">
      <p class="eyebrow">Responder Zugang</p>
      <h1>QR Login</h1>

      @if (error) {
        <p class="form-error">{{ error }}</p>
      }

      <form [formGroup]="qrForm" (ngSubmit)="submitQr()" class="auth-form">
        <label>
          QR Code
          <input formControlName="qrCode" autocomplete="one-time-code" autofocus>
        </label>
        <button type="submit" [disabled]="busy || qrForm.invalid">Einloggen</button>
      </form>

      <app-qr-scanner (scanned)="submitQr($event)" />

      <h2>Responder Login</h2>
      <form [formGroup]="userForm" (ngSubmit)="submitUser()" class="auth-form">
        <label>
          Benutzername
          <input formControlName="username" autocomplete="username">
        </label>
        <label>
          Passwort
          <input formControlName="password" type="password" autocomplete="current-password">
        </label>
        <button type="submit" [disabled]="busy || userForm.invalid">Mit Passwort einloggen</button>
      </form>

      <nav class="auth-links">
        <a routerLink="/admin/login">Admin / Leitstelle</a>
      </nav>

      <app-dev-access role="user" />
    </section>
  `,
})
export class LoginPage {
  protected readonly qrForm = inject(FormBuilder).nonNullable.group({
    qrCode: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly userForm = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected busy = false;
  protected error = '';

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected submitQr(qrCode = this.qrForm.controls.qrCode.value): void {
    this.run(() => this.api.qrLogin(qrCode.trim()).subscribe({
      next: (result) => {
        this.auth.setResponderSession({ token: result.token, tokenType: 'qr', eventSceneId: result.eventSceneId });
        this.router.navigateByUrl('/role-selection');
      },
      error: () => this.fail('QR Code ist ungültig oder abgelaufen.'),
    }));
  }

  protected submitUser(): void {
    this.run(() => this.api.userLogin(this.userForm.getRawValue()).subscribe({
      next: (result) => {
        this.auth.setResponderSession({
          token: result.token,
          refreshToken: result.refreshToken,
          tokenType: 'user',
          username: this.userForm.controls.username.value,
        });
        this.router.navigateByUrl('/role-selection');
      },
      error: () => this.fail('Benutzername oder Passwort ist ungültig.'),
    }));
  }

  private run(action: () => void): void {
    this.busy = true;
    this.error = '';
    action();
  }

  private fail(message: string): void {
    this.busy = false;
    this.error = message;
  }

}
