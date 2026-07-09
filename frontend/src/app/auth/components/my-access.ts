import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';

@Component({
  selector: 'app-my-access',
  template: `
    @if (auth.activeSession(); as session) {
      <aside class="my-access" aria-label="Meine Sitzung">
        <div>
          <strong>{{ label(session.tokenType) }}</strong>
          <span>{{ session.username || 'QR Sitzung' }}</span>
        </div>
        <button type="button" (click)="selfCancel()" [disabled]="busy">
          {{ busy ? 'Beende...' : 'Zugang beenden' }}
        </button>
      </aside>
    }
  `,
})
export class MyAccess {
  protected readonly auth = inject(AuthStore);
  protected busy = false;

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected selfCancel(): void {
    this.busy = true;
    this.api.selfCancel().subscribe({
      next: () => this.finish(),
      error: () => this.finish(),
    });
  }

  protected label(tokenType: string): string {
    return tokenType === 'qr' ? 'Responder QR' : tokenType;
  }

  private finish(): void {
    this.auth.clear();
    this.router.navigateByUrl('/login');
  }
}
