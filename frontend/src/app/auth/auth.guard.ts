import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { ApiClient } from '../api/api-client';
import { AuthStore, GuardRequirement, TokenType } from './auth.store';

export function requireSession(requirement: GuardRequirement): CanActivateFn {
  return () => {
    const auth = inject(AuthStore);
    const api = inject(ApiClient);
    const router = inject(Router);

    if (!auth.hasPersistedSession(requirement)) {
      return router.createUrlTree([loginRoute(requirement)]);
    }

    if (!navigator.onLine) {
      return true;
    }

    return api.validateToken().pipe(
      map((result) => auth.sessionMatches(auth.activeSession(), requirement) && (!result.role || auth.sessionMatches({ token: '', tokenType: result.role as TokenType, savedAt: '' }, requirement))
        ? true
        : router.createUrlTree([loginRoute(requirement)])),
      catchError(() => of(router.createUrlTree([loginRoute(requirement)]))),
    );
  };
}

function loginRoute(requirement: GuardRequirement): string {
  return requirement === 'admin' || requirement === 'leitstelle' ? '/admin/login' : '/login';
}
