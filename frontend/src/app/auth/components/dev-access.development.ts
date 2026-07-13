import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../auth.store';

@Component({
  selector: 'app-dev-access',
  template: `
    <button type="button" class="dev-button" (click)="login()" [disabled]="busy">
      DEV {{ role() === 'admin' ? 'Admin' : 'Responder' }}
    </button>
    @if (error) {
      <p class="form-error">{{ error }}</p>
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
          this.auth.setAdminSession({ token: result.token, refreshToken: result.refreshToken, tokenType: 'admin', username: 'DEV' });
          this.router.navigateByUrl('/admin');
        } else {
          this.auth.setResponderSession({ token: result.token, refreshToken: result.refreshToken, tokenType: 'user', username: 'DEV' });
          this.router.navigateByUrl('/role-selection');
        }
      },
      error: () => {
        this.busy = false;
        this.error = 'DEV Login ist nicht verfügbar.';
      },
    });
  }
}
