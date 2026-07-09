import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <section class="home">
      <div>
        <p class="eyebrow">Ambulanzsystem V1</p>
        <h1>Frontend foundation</h1>
        <p>F1 stellt Routing, Auth-Session, API-Vertrag und Sync-Status bereit.</p>
      </div>

      <nav class="route-grid" aria-label="F1 routes">
        @for (route of routes; track route.path) {
          <a [routerLink]="route.path">
            <strong>{{ route.label }}</strong>
            <span>{{ route.path }}</span>
          </a>
        }
      </nav>
    </section>
  `,
})
export class Home {
  protected readonly routes = [
    { path: '/login', label: 'QR Login' },
    { path: '/admin/login', label: 'Admin Login' },
    { path: '/role-selection', label: 'Rollenwahl' },
    { path: '/scan-patient', label: 'Patient QR' },
    { path: '/triage', label: 'Triage' },
    { path: '/ambulanzprotokoll/demo', label: 'Ambulanzprotokoll' },
    { path: '/body/front', label: 'Körper vorne' },
    { path: '/body/back', label: 'Körper hinten' },
    { path: '/teams', label: 'Teams' },
    { path: '/situation-room', label: 'Lagebild' },
    { path: '/admin', label: 'Admin' },
  ];
}
