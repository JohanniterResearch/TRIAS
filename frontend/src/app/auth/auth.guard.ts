import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, switchMap, throwError } from 'rxjs';

import { ApiClient, ApiRequestError, isAuthFailure } from '../api/api-client';
import { AuthStore, GuardRequirement, TokenType } from './auth.store';
import { homeRouteForToken } from './auth.rules';
import { SessionRefreshService } from './session-refresh.service';
import { SyncStatusService } from '../sync/sync-status.service';

const validationRetryDelayMs = 30_000;
const validationRetryMaximumDelayMs = 5 * 60_000;
const validationRetryTimers = new Map<unknown, number>();

export function requireSession(
  requirement: GuardRequirement,
  offlineCapable = false,
): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthStore);
    const api = inject(ApiClient);
    const refresh = inject(SessionRefreshService);
    const router = inject(Router);
    const sync = inject(SyncStatusService);
    const activeSession = auth.activeSession();
    const activeType = activeSession?.tokenType;
    const sessionRefreshToken = activeSession?.refreshToken;
    const sessionOwnerKey = auth.sessionIdentity();
    let refreshFailed = false;
    const sessionStillOwned = () =>
      !!auth.activeSession() && auth.sessionIdentity() === sessionOwnerKey;
    const staleOutcome = () => of(router.createUrlTree([loginRoute(requirement, activeType)]));
    const validateCurrentToken = (): ReturnType<ApiClient['validateToken']> => {
      const token = auth.activeSession()?.token;
      return api
        .validateToken()
        .pipe(
          catchError((error) =>
            isAuthFailure(error) && sessionStillOwned() && auth.activeSession()?.token !== token
              ? validateCurrentToken()
              : throwError(() => error),
          ),
        );
    };
    const retryValidation = (delay = validationRetryDelayMs) => {
      if (validationRetryTimers.has(sessionOwnerKey)) {
        return;
      }
      const timer = window.setTimeout(() => {
        if (!navigator.onLine || !sessionStillOwned()) {
          validationRetryTimers.delete(sessionOwnerKey);
          return;
        }
        validateCurrentToken().subscribe({
          next: (result) => {
            validationRetryTimers.delete(sessionOwnerKey);
            if (
              sessionStillOwned() &&
              validationResult(auth, requirement, result.role as TokenType | undefined)
            ) {
              sync.clearValidationDegraded();
            }
          },
          error: (error) => {
            validationRetryTimers.delete(sessionOwnerKey);
            if (!sessionStillOwned()) {
              return;
            }
            if (isAuthFailure(error)) {
              sync.clearValidationDegraded();
              auth.markExpired();
            } else if (isTransportFailure(error)) {
              retryValidation(Math.min(delay * 2, validationRetryMaximumDelayMs));
            }
          },
        });
      }, delay);
      validationRetryTimers.set(sessionOwnerKey, timer);
    };

    if (!auth.hasPersistedSession(requirement)) {
      return router.createUrlTree([loginRoute(requirement, activeType)]);
    }

    if (auth.requiresPasswordChange() && state.url !== '/change-password') {
      return router.createUrlTree(['/change-password']);
    }

    if (!navigator.onLine) {
      return canUseOffline(auth, offlineCapable)
        ? true
        : router.createUrlTree([loginRoute(requirement, activeType)]);
    }

    const validate = () =>
      !sessionStillOwned()
        ? staleOutcome()
        : validateCurrentToken().pipe(
            map((result) => {
              if (!sessionStillOwned()) {
                return router.createUrlTree([loginRoute(requirement, activeType)]);
              }
              sync.clearValidationDegraded();
              return validationResult(auth, requirement, result.role as TokenType | undefined);
            }),
          );
    return validate().pipe(
      catchError((error) => {
        return isAuthFailure(error) &&
          error.status === 401 &&
          sessionRefreshToken &&
          sessionStillOwned()
          ? refresh.refreshSession().pipe(
              catchError((refreshError) => {
                refreshFailed = true;
                return throwError(() => refreshError);
              }),
              switchMap(validate),
            )
          : throwError(() => error);
      }),
      catchError((error) => {
        if (!sessionStillOwned()) {
          return staleOutcome();
        }
        if (isTransportFailure(error) && canUseOffline(auth, offlineCapable)) {
          sync.markValidationDegraded();
          retryValidation();
          return of(true);
        }
        sync.clearValidationDegraded();
        if (
          (isAuthFailure(error) || activeType === 'admin' || activeType === 'leitstelle') &&
          (!refreshFailed || sessionStillOwned())
        ) {
          auth.markExpired();
        }
        return of(router.createUrlTree([loginRoute(requirement, activeType)]));
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
    const requiredLogin =
      session.tokenType === 'admin' || session.tokenType === 'leitstelle'
        ? '/admin/login'
        : '/login';
    return state.url === requiredLogin ? true : router.createUrlTree([requiredLogin]);
  }
  return router.createUrlTree([
    homeRouteForToken(session.tokenType, session.requiresPasswordChange),
  ]);
};

function canUseOffline(auth: AuthStore, offlineCapable: boolean): boolean {
  const role = auth.activeSession()?.tokenType;
  return offlineCapable && (role === 'user' || role === 'qr');
}

function isTransportFailure(error: unknown): boolean {
  return !(error instanceof ApiRequestError);
}

function validationResult(
  auth: AuthStore,
  requirement: GuardRequirement,
  serverRole?: TokenType,
): boolean {
  return (
    auth.sessionMatches(auth.activeSession(), requirement) &&
    (!serverRole ||
      auth.sessionMatches({ token: '', tokenType: serverRole, savedAt: '' }, requirement))
  );
}

function loginRoute(requirement: GuardRequirement, activeType?: TokenType): string {
  return requirement === 'admin' ||
    requirement === 'leitstelle' ||
    activeType === 'admin' ||
    activeType === 'leitstelle'
    ? '/admin/login'
    : '/login';
}
