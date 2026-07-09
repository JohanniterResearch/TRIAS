import { Component, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { SyncIndicator } from './sync/sync-indicator';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, SyncIndicator],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('Ambulanzsystem');
}
