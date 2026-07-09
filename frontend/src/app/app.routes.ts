import { Routes } from '@angular/router';

import { AdminLoginPage } from './auth/pages/admin-login-page';
import { ChangePasswordPage } from './auth/pages/change-password-page';
import { LoginPage } from './auth/pages/login-page';
import { requireSession } from './auth/auth.guard';
import { Home } from './pages/home';
import { PagePlaceholder } from './pages/page-placeholder';

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
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'Rollenwahl', stage: 'F4' }
  },
  {
    path: 'scan-patient',
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'Patient scannen', stage: 'F4' }
  },
  {
    path: 'triage',
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'START Triage erfassen', stage: 'F4', description: 'Record-only Triage, kein Entscheidungsbaum.' }
  },
  {
    path: 'ambulanzprotokoll/:patientId',
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'Ambulanzprotokoll', stage: 'F5' }
  },
  {
    path: 'body/front',
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'Körper vorne markieren', stage: 'F4/F5' }
  },
  {
    path: 'body/back',
    component: PagePlaceholder,
    canActivate: [requireSession('responder-or-qr')],
    data: { title: 'Körper hinten markieren', stage: 'F4/F5' }
  },
  {
    path: 'teams',
    component: PagePlaceholder,
    canActivate: [requireSession('leitstelle')],
    data: { title: 'Teams', stage: 'F6' }
  },
  {
    path: 'situation-room',
    component: PagePlaceholder,
    canActivate: [requireSession('leitstelle')],
    data: { title: 'Lagebild', stage: 'F6' }
  },
  {
    canActivate: [requireSession('admin')],
    path: 'admin',
    children: [
      {
        path: '',
        component: PagePlaceholder,
        data: { title: 'Admin', stage: 'F3' }
      },
      {
        path: '**',
        component: PagePlaceholder,
        data: { title: 'Admin', stage: 'F3' }
      }
    ]
  },
  {
    path: '**',
    component: PagePlaceholder,
    data: { title: 'Nicht gefunden', stage: '404', description: 'Diese Seite existiert nicht.' }
  },
];
