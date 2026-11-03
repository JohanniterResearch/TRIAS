import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { AuthStore } from './auth/auth.store';
import { ResponderStateStore } from './responder/services/responder-state';
import { SyncIndicator } from './sync/sync-indicator';
import { SyncIssues } from './sync/sync-issues';
import { LocalWorkspaceService } from './sync/local-workspace.service';
import { OfflineQueueService } from './sync/offline-queue.service';
import { SessionRefreshService } from './auth/session-refresh.service';
import { ThemeToggle } from './theme/theme-toggle';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, SyncIndicator, SyncIssues, ThemeToggle],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly state = inject(ResponderStateStore);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly sessionRefresh = inject(SessionRefreshService);
  private readonly localWorkspace = inject(LocalWorkspaceService);

  protected roleLabel(): string {
    const role = this.auth.activeSession()?.tokenType;
    switch (role) {
      case 'admin':
        return 'Administration';
      case 'leitstelle':
        return 'Leitstelle';
      case 'user':
        return 'Rettungsdienst';
      case 'qr':
        return 'QR-Zugang';
      default:
        return 'Nicht angemeldet';
    }
  }
}
