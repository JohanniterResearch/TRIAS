import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';
import { homeRouteForToken } from '../auth.rules';

@Component({
  selector: 'app-dev-access',
  template: `
    <button type="button" class="dev-button" (click)="login()" [disabled]="busy">
      DEV {{ role() === 'admin' ? 'Admin' : 'Responder' }}
    </button>
    @if (error) {
      <p class="form-error" role="alert" aria-live="assertive">{{ error }}</p>
    }
    @if (busy) {
      <p class="status-message" role="status" aria-live="polite">DEV Anmeldung läuft.</p>
    }
  `,
})
export class DevAccess {
  readonly role = input.required<'admin' | 'user'>();
  protected busy = false;
  protected error = '';

  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected login(): void {
    this.busy = true;
    this.error = '';
    this.api.devLogin(this.role()).subscribe({
      next: (result) => {
        if (this.role() === 'admin') {
          this.auth.setAdminSession({
            token: result.token,
            tokenType: 'admin',
            username: result.username,
            requiresPasswordChange: result.requiresPasswordChange,
          });
          this.router.navigateByUrl(homeRouteForToken('admin', result.requiresPasswordChange));
        } else {
          this.auth.setResponderSession({
            token: result.token,
            tokenType: 'user',
            username: result.username,
            requiresPasswordChange: result.requiresPasswordChange,
          });
          this.router.navigateByUrl(homeRouteForToken('user', result.requiresPasswordChange));
        }
      },
      error: (error: unknown) => {
        this.busy = false;
        this.error = apiErrorMessage(error, 'DEV Login ist nicht verfügbar.');
      },
    });
  }
}
