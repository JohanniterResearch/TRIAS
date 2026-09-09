import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { apiErrorMessage, ApiClient } from '../../api/api-client';
import type { components } from '../../api/openapi-types';
import { MyAccess } from '../../auth/components/my-access';
import { ResponderStateStore } from '../services/responder-state';

type OperationScene = components['schemas']['OperationScene'];

@Component({
  selector: 'app-role-selection-page',
  imports: [MyAccess, RouterLink],
  template: `
    <section class="responder-page">
      <app-my-access />
      <p class="eyebrow">Einsatz wählen</p>
      <h1>Szene auswählen</h1>

      @if (error()) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
      }
      @if (busy()) {
        <p class="status-message" role="status" aria-live="polite">Szenen werden geladen.</p>
      }

      <button type="button" (click)="loadScenes()" [disabled]="busy()">Szenen laden</button>

      <div class="choice-grid">
        @for (scene of scenes(); track scene.id) {
          <button type="button" (click)="selectScene(scene)">
            <strong>{{ scene.name }}</strong>
            <span>ID {{ scene.id }} · {{ scene.active ? 'aktiv' : 'inaktiv' }}</span>
          </button>
        }
      </div>

      @if (state.scene(); as scene) {
        <section class="selected-panel">
          <strong>Ausgewählt: {{ scene.name }}</strong>
          <div class="row-actions">
            <a routerLink="/scan-patient">Patient aufnehmen</a>
            <a routerLink="/situation-room">Lagebild</a>
          </div>
        </section>
      }
    </section>
  `,
})
export class RoleSelectionPage {
  protected readonly state = inject(ResponderStateStore);
  protected readonly scenes = signal<OperationScene[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  constructor() {
    this.loadScenes();
  }

  protected loadScenes(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.listScenes().subscribe({
      next: (scenes) => {
        this.scenes.set(scenes.filter((scene) => scene.active));
        this.busy.set(false);
      },
      error: (error: unknown) => {
        this.error.set(apiErrorMessage(error, 'Szenen konnten nicht geladen werden.'));
        this.busy.set(false);
      },
    });
  }

  protected selectScene(scene: OperationScene): void {
    this.state.setScene(scene);
    this.router.navigateByUrl('/scan-patient');
  }
}
