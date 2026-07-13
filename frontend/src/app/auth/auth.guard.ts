import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap, throwError } from 'rxjs';

import { ApiClient, isAuthFailure } from '../api/api-client';
import { AuthStore, GuardRequirement, TokenType } from './auth.store';

export function requireSession(requirement: GuardRequirement): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthStore);
    const api = inject(ApiClient);
    const router = inject(Router);

    if (!auth.hasPersistedSession(requirement)) {
      return router.createUrlTree([loginRoute(requirement)]);
    }

    if (auth.requiresPasswordChange() && state.url !== '/change-password') {
      return router.createUrlTree(['/change-password']);
    }

    if (!navigator.onLine) {
      return true;
    }

    const validate = () => api.validateToken().pipe(map((result) => validationResult(auth, requirement, result.role as TokenType | undefined)));
    return validate().pipe(
      catchError((error) => {
        if (!isAuthFailure(error)) {
          return of(true);
        }
        return error.status === 401 ? api.refreshSession().pipe(switchMap(validate)) : throwError(() => error);
      }),
      catchError((error) => {
        if (!isAuthFailure(error)) {
          return of(true);
        }
        auth.markExpired();
        return of(router.createUrlTree([loginRoute(requirement)]));
      }),
    );
  };
}

export const guestOnly: CanActivateFn = (_route, state) => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  const session = auth.activeSession();
  if (!session) {
    return true;
  }
  if (session.expired) {
    const requiredLogin = session.tokenType === 'admin' || session.tokenType === 'leitstelle' ? '/admin/login' : '/login';
    return state.url === requiredLogin ? true : router.createUrlTree([requiredLogin]);
  }
  if (session.requiresPasswordChange) {
    return router.createUrlTree(['/change-password']);
  }
  return router.createUrlTree([session.tokenType === 'admin' || session.tokenType === 'leitstelle' ? '/admin' : '/role-selection']);
};

function validationResult(auth: AuthStore, requirement: GuardRequirement, serverRole?: TokenType): boolean {
  return auth.sessionMatches(auth.activeSession(), requirement)
    && (!serverRole || auth.sessionMatches({ token: '', tokenType: serverRole, savedAt: '' }, requirement));
}

function loginRoute(requirement: GuardRequirement): string {
  return requirement === 'admin' || requirement === 'leitstelle' ? '/admin/login' : '/login';
}
