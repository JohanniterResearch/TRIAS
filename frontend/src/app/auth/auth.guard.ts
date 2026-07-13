import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';

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

    const validate = () => api.validateToken().pipe(map((result) => validationResult(auth, requirement, result.role as TokenType | undefined)));
    return validate().pipe(
      catchError(() => api.refreshSession().pipe(switchMap(validate))),
      catchError(() => {
        auth.clear();
        return of(router.createUrlTree([loginRoute(requirement)]));
      }),
    );
  };
}

function validationResult(auth: AuthStore, requirement: GuardRequirement, serverRole?: TokenType): boolean {
  return auth.sessionMatches(auth.activeSession(), requirement)
    && (!serverRole || auth.sessionMatches({ token: '', tokenType: serverRole, savedAt: '' }, requirement));
}

function loginRoute(requirement: GuardRequirement): string {
  return requirement === 'admin' || requirement === 'leitstelle' ? '/admin/login' : '/login';
}
