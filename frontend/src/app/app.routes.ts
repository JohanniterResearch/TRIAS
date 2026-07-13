import { Routes } from '@angular/router';

import { AdminLoginPage } from './auth/pages/admin-login-page';
import { ChangePasswordPage } from './auth/pages/change-password-page';
import { LoginPage } from './auth/pages/login-page';
import { requireSession } from './auth/auth.guard';
import { Home } from './pages/home';
import { PagePlaceholder } from './pages/page-placeholder';
import { BodyMapPage } from './responder/pages/body-map-page';
import { PatientChoicePage } from './responder/pages/patient-choice-page';
import { PatientScanPage } from './responder/pages/patient-scan-page';
import { RoleSelectionPage } from './responder/pages/role-selection-page';

export const routes: Routes = [
  { path: '', component: Home },
  {
    path: 'login',
    component: LoginPage,
  },
  {
    path: 'admin/login',
    component: AdminLoginPage,
  },
  {
    path: 'change-password',
    component: ChangePasswordPage,
    canActivate: [requireSession('leitstelle')],
  },
  {
    path: 'role-selection',
    component: RoleSelectionPage,
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'scan-patient',
    component: PatientScanPage,
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'patient/:patientId',
    component: PatientChoicePage,
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'triage',
    loadComponent: () => import('./responder/pages/triage-page').then((module) => module.TriagePage),
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'ambulanzprotokoll/:patientId',
    loadComponent: () => import('./protokoll/pages/ambulanzprotokoll-page').then((module) => module.AmbulanzprotokollPage),
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'body/front',
    component: BodyMapPage,
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'body/back',
    component: BodyMapPage,
    canActivate: [requireSession('responder-or-qr')],
  },
  {
    path: 'teams',
    component: PagePlaceholder,
    canActivate: [requireSession('leitstelle')],
    data: { title: 'Teams', stage: 'F6' }
  },
  {
    path: 'situation-room',
    loadComponent: () => import('./situation/pages/situation-room-page').then((module) => module.SituationRoomPage),
    canActivate: [requireSession('authenticated')],
  },
  {
    canActivate: [requireSession('admin')],
    path: 'admin',
    children: [
      {
        path: '',
        loadComponent: () => import('./admin/pages/admin-dashboard').then((module) => module.AdminDashboard),
      },
      {
        path: '**',
        loadComponent: () => import('./admin/pages/admin-dashboard').then((module) => module.AdminDashboard),
      }
    ]
  },
  {
    path: '**',
    component: PagePlaceholder,
    data: { title: 'Nicht gefunden', stage: '404', description: 'Diese Seite existiert nicht.' }
  },
];
