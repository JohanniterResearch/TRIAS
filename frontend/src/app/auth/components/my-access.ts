import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { ApiClient } from '../../api/api-client';
import { LocalWorkspaceService } from '../../sync/local-workspace.service';
import { SyncStatusService } from '../../sync/sync-status.service';
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
        <button type="button" (click)="selfCancel()" [disabled]="busy || !sync.queueReady() || sync.pendingCount() > 0">
          {{ busy ? 'Beende...' : 'Zugang beenden' }}
        </button>
        @if (sync.pendingCount() > 0) {
          <p class="form-error">Zugang kann erst nach dem Abschluss der Synchronisierung beendet werden.</p>
        }
      </aside>
    }
  `,
})
export class MyAccess {
  protected readonly auth = inject(AuthStore);
  protected readonly sync = inject(SyncStatusService);
  protected busy = false;

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly localWorkspace = inject(LocalWorkspaceService);

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

  private async finish(): Promise<void> {
    await this.localWorkspace.clear();
    this.auth.clear();
    await this.router.navigateByUrl('/login');
  }
}
