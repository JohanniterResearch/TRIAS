import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { SyncIndicator } from './sync/sync-indicator';
import { SyncIssues } from './sync/sync-issues';
import { LocalWorkspaceService } from './sync/local-workspace.service';
import { OfflineQueueService } from './sync/offline-queue.service';
import { SessionRefreshService } from './auth/session-refresh.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, SyncIndicator, SyncIssues],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly sessionRefresh = inject(SessionRefreshService);
  private readonly localWorkspace = inject(LocalWorkspaceService);
}
