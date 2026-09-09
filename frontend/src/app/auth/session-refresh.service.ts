import { effect, inject, Injectable } from '@angular/core';
import { finalize, Observable, shareReplay } from 'rxjs';

import { ApiClient, isAuthFailure } from '../api/api-client';
import { AuthStore } from './auth.store';

const refreshLeadTimeMs = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SessionRefreshService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private inFlight: {
    ownerRefreshToken: string;
    ownerIdentity: object;
    operation: Observable<void>;
  } | null = null;

  constructor() {
    effect((onCleanup) => {
      const session = this.auth.activeSession();
      const expiresAt = this.auth.tokenExpiresAt();
      if (!session || session.expired || !expiresAt) {
        return;
      }

      const ownerIdentity = this.auth.sessionIdentity();
      const action = session.refreshToken
        ? () => this.triggerRefresh(session.refreshToken, ownerIdentity)
        : () => this.expireSession(ownerIdentity);
      const leadTime = session.refreshToken ? refreshLeadTimeMs : 0;
      const timer = window.setTimeout(action, Math.max(0, expiresAt - Date.now() - leadTime));
      onCleanup(() => window.clearTimeout(timer));
    });
    window.addEventListener('online', () => this.refreshIfNeeded());
  }

  refreshSession(): Observable<void> {
    const ownerRefreshToken = this.auth.activeSession()?.refreshToken;
    const ownerIdentity = this.auth.sessionIdentity();
    if (!ownerRefreshToken) {
      return this.api.refreshSession();
    }
    if (
      this.inFlight?.ownerRefreshToken === ownerRefreshToken &&
      this.inFlight.ownerIdentity === ownerIdentity
    ) {
      return this.inFlight.operation;
    }

    const operation = this.api.refreshSession().pipe(
      finalize(() => {
        if (this.inFlight?.operation === operation) {
          this.inFlight = null;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlight = { ownerRefreshToken, ownerIdentity, operation };
    return operation;
  }

  private refreshIfNeeded(): void {
    const expiresAt = this.auth.tokenExpiresAt();
    const session = this.auth.activeSession();
    if (expiresAt && session?.refreshToken && expiresAt - Date.now() <= refreshLeadTimeMs) {
      this.triggerRefresh();
    } else if (expiresAt && session && !session.refreshToken && expiresAt <= Date.now()) {
      this.expireSession();
    }
  }

  private triggerRefresh(
    ownerRefreshToken = this.auth.activeSession()?.refreshToken,
    ownerIdentity = this.auth.sessionIdentity(),
  ): void {
    if (
      !navigator.onLine ||
      !ownerRefreshToken ||
      this.auth.sessionIdentity() !== ownerIdentity ||
      this.auth.activeSession()?.refreshToken !== ownerRefreshToken
    ) {
      return;
    }
    this.refreshSession().subscribe({
      error: (error) => {
        if (
          this.auth.sessionIdentity() !== ownerIdentity ||
          this.auth.activeSession()?.refreshToken !== ownerRefreshToken
        ) {
          return;
        }
        if (isAuthFailure(error)) {
          this.expireSession();
        } else {
          window.setTimeout(() => this.triggerRefresh(ownerRefreshToken, ownerIdentity), 30_000);
        }
      },
    });
  }

  private expireSession(ownerIdentity = this.auth.sessionIdentity()): void {
    if (this.auth.sessionIdentity() !== ownerIdentity) return;
    const session = this.auth.activeSession();
    this.auth.markExpired();
    location.assign(
      session?.tokenType === 'admin' || session?.tokenType === 'leitstelle'
        ? '/admin/login'
        : '/login',
    );
  }
}
