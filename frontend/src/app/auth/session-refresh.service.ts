import { effect, inject, Injectable } from '@angular/core';

import { ApiClient, isAuthFailure } from '../api/api-client';
import { AuthStore } from './auth.store';

const refreshLeadTimeMs = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SessionRefreshService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private refreshing = false;

  constructor() {
    effect((onCleanup) => {
      const session = this.auth.activeSession();
      const expiresAt = this.auth.tokenExpiresAt();
      if (!session || session.expired || !expiresAt) {
        return;
      }

      const action = session.refreshToken ? () => this.refresh() : () => this.expireSession();
      const leadTime = session.refreshToken ? refreshLeadTimeMs : 0;
      const timer = window.setTimeout(action, Math.max(0, expiresAt - Date.now() - leadTime));
      onCleanup(() => window.clearTimeout(timer));
    });
    window.addEventListener('online', () => this.refreshIfNeeded());
  }

  private refreshIfNeeded(): void {
    const expiresAt = this.auth.tokenExpiresAt();
    const session = this.auth.activeSession();
    if (expiresAt && session?.refreshToken && expiresAt - Date.now() <= refreshLeadTimeMs) {
      this.refresh();
    } else if (expiresAt && session && !session.refreshToken && expiresAt <= Date.now()) {
      this.expireSession();
    }
  }

  private refresh(): void {
    if (!navigator.onLine || this.refreshing) {
      return;
    }
    this.refreshing = true;
    this.api.refreshSession().subscribe({
      next: () => this.refreshing = false,
      error: (error) => {
        this.refreshing = false;
        if (isAuthFailure(error)) {
          this.expireSession();
        } else {
          window.setTimeout(() => this.refresh(), 30_000);
        }
      },
    });
  }

  private expireSession(): void {
    const session = this.auth.activeSession();
    this.auth.markExpired();
    location.assign(session?.tokenType === 'admin' || session?.tokenType === 'leitstelle' ? '/admin/login' : '/login');
  }
}
