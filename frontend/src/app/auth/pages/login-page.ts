import { Component, ElementRef, inject, OnDestroy, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';
import { DevAccess } from '../components/dev-access';

declare const BarcodeDetector: undefined | {
  new(options?: { formats?: string[] }): { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };
};

@Component({
  selector: 'app-login-page',
  imports: [DevAccess, ReactiveFormsModule, RouterLink],
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

      <div class="camera-panel">
        <video #video autoplay muted playsinline></video>
        <button type="button" (click)="startScan()" [disabled]="busy || scanning">
          {{ scanning ? 'Kamera aktiv' : 'Mit Kamera scannen' }}
        </button>
      </div>

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
export class LoginPage implements OnDestroy {
  protected readonly qrForm = inject(FormBuilder).nonNullable.group({
    qrCode: ['', [Validators.required, Validators.maxLength(128)]],
  });
  protected readonly userForm = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected busy = false;
  protected error = '';
  protected scanning = false;

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private scanTimer = 0;

  ngOnDestroy(): void {
    this.stopScan();
  }

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

  protected async startScan(): Promise<void> {
    if (!BarcodeDetector) {
      this.fail('QR Scan wird von diesem Browser nicht unterstützt. QR Code bitte eintippen.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = this.video()?.nativeElement;
      if (!video) {
        return;
      }

      video.srcObject = this.stream;
      this.scanning = true;
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        const [code] = await detector.detect(video);
        if (code?.rawValue) {
          this.stopScan();
          this.qrForm.controls.qrCode.setValue(code.rawValue);
          this.submitQr(code.rawValue);
          return;
        }
        this.scanTimer = window.setTimeout(scan, 500);
      };
      this.scanTimer = window.setTimeout(scan, 500);
    } catch {
      this.fail('Kamera konnte nicht gestartet werden. QR Code bitte eintippen.');
    }
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

  private stopScan(): void {
    window.clearTimeout(this.scanTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.scanning = false;
  }
}
