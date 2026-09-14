import { Routes } from '@angular/router';

import { AdminLoginPage } from './auth/pages/admin-login-page';
import { ChangePasswordPage } from './auth/pages/change-password-page';
import { LoginPage } from './auth/pages/login-page';
import { guestOnly, requireSession } from './auth/auth.guard';
import { Home } from './pages/home';
import { PagePlaceholder } from './pages/page-placeholder';
import { BodyMapPage } from './responder/pages/body-map-page';
import { PatientChoicePage } from './responder/pages/patient-choice-page';
import { PatientScanPage } from './responder/pages/patient-scan-page';
import { RoleSelectionPage } from './responder/pages/role-selection-page';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: Home, canActivate: [guestOnly] },
  // Same page as '/', but reachable regardless of session state — '/' redirects an active
  // session onward (see guestOnly), so this is the one link that always works from any page.
  { path: 'menu', component: Home },
  {
    path: 'login',
    component: LoginPage,
    canActivate: [guestOnly],
  },
  {
    path: 'admin/login',
    component: AdminLoginPage,
    canActivate: [guestOnly],
  },
  {
    path: 'change-password',
    component: ChangePasswordPage,
    canActivate: [requireSession('leitstelle')],
  },
  {
    path: 'role-selection',
    component: RoleSelectionPage,
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'scan-patient',
    component: PatientScanPage,
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'patient/:patientId',
    component: PatientChoicePage,
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'triage',
    loadComponent: () =>
      import('./responder/pages/triage-page').then((module) => module.TriagePage),
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'ambulanzprotokoll/:patientId',
    loadComponent: () =>
      import('./protokoll/pages/ambulanzprotokoll-page').then(
        (module) => module.AmbulanzprotokollPage,
      ),
    canActivate: [requireSession('authenticated', true)],
  },
  {
    path: 'body/front',
    component: BodyMapPage,
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'body/back',
    component: BodyMapPage,
    canActivate: [requireSession('responder-or-qr', true)],
  },
  {
    path: 'teams',
    loadComponent: () =>
      import('./situation/pages/situation-room-page').then((module) => module.SituationRoomPage),
    canActivate: [requireSession('leitstelle')],
  },
  {
    path: 'situation-room',
    loadComponent: () =>
      import('./situation/pages/situation-room-page').then((module) => module.SituationRoomPage),
    canActivate: [requireSession('authenticated')],
  },
  {
    canActivate: [requireSession('admin')],
    path: 'admin',
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./admin/pages/admin-dashboard').then((module) => module.AdminDashboard),
      },
      {
        path: '**',
        loadComponent: () =>
          import('./admin/pages/admin-dashboard').then((module) => module.AdminDashboard),
      },
    ],
  },
  {
    path: '**',
    component: PagePlaceholder,
    data: { title: 'Nicht gefunden', stage: '404', description: 'Diese Seite existiert nicht.' },
  },
];
