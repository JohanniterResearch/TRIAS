import { effect, inject, Injectable } from '@angular/core';

import { ApiClient } from '../api/api-client';
import { LocalWorkspaceService } from '../sync/local-workspace.service';
import { AuthStore } from './auth.store';

const refreshLeadTimeMs = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SessionRefreshService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthStore);
  private readonly localWorkspace = inject(LocalWorkspaceService);
  private refreshing = false;

  constructor() {
    effect((onCleanup) => {
      const session = this.auth.activeSession();
      const expiresAt = this.auth.tokenExpiresAt();
      if (!session?.refreshToken || !expiresAt) {
        return;
      }

      const timer = window.setTimeout(() => this.refresh(), Math.max(0, expiresAt - Date.now() - refreshLeadTimeMs));
      onCleanup(() => window.clearTimeout(timer));
    });
    window.addEventListener('online', () => this.refreshIfNeeded());
  }

  private refreshIfNeeded(): void {
    const expiresAt = this.auth.tokenExpiresAt();
    if (expiresAt && expiresAt - Date.now() <= refreshLeadTimeMs) {
      this.refresh();
    }
  }

  private refresh(): void {
    if (!navigator.onLine || this.refreshing) {
      return;
    }
    this.refreshing = true;
    this.api.refreshSession().subscribe({
      next: () => this.refreshing = false,
      error: () => {
        this.refreshing = false;
        this.expireSession();
      },
    });
  }

  private async expireSession(): Promise<void> {
    await this.localWorkspace.clear();
    this.auth.clear();
    location.assign('/login');
  }
}
