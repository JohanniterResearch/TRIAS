import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import { LocalWorkspaceService } from '../../sync/local-workspace.service';
import { OfflineQueueService } from '../../sync/offline-queue.service';
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
        <button type="button" (click)="selfCancel()" [disabled]="busy || queue.hasPendingWork()">
          {{ busy ? 'Beende...' : 'Zugang beenden' }}
        </button>
        @if (queue.hasPendingWork()) {
          <p class="form-error" role="alert" aria-live="assertive">
            Zugang kann erst nach dem Abschluss der Synchronisierung beendet werden.
          </p>
        }
        @if (error) {
          <p class="form-error" role="alert" aria-live="assertive">{{ error }}</p>
        }
      </aside>
    }
  `,
})
export class MyAccess {
  protected readonly auth = inject(AuthStore);
  protected readonly queue = inject(OfflineQueueService);
  protected busy = false;
  protected error = '';

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly localWorkspace = inject(LocalWorkspaceService);

  protected selfCancel(): void {
    if (this.busy || this.queue.hasPendingWork()) return;
    this.busy = true;
    this.error = '';
    this.api.selfCancel().subscribe({
      next: () => this.finish(),
      error: (error: unknown) => {
        const message = apiErrorMessage(error, '');
        if (message) {
          this.busy = false;
          this.error = message;
          return;
        }
        this.finish();
      },
    });
  }

  protected label(tokenType: string): string {
    return tokenType === 'qr' ? 'Responder QR' : tokenType;
  }

  private async finish(): Promise<void> {
    try {
      await this.localWorkspace.clear();
      this.auth.clear();
      await this.router.navigateByUrl('/login');
    } catch {
      // Pending work must keep its session and workspace when clearing is refused.
    } finally {
      this.busy = false;
    }
  }
}
