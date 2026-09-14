import { TestBed } from '@angular/core/testing';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom, isObservable, of, Subject, throwError } from 'rxjs';

import { ApiClient, ApiRequestError } from '../api/api-client';
import { routes } from '../app.routes';
import { AuthStore } from './auth.store';
import { SessionRefreshService } from './session-refresh.service';
import { SyncStatusService } from '../sync/sync-status.service';

describe('route guard failure modes', () => {
  const auth: any = {
    hasPersistedSession: vi.fn(() => true),
    requiresPasswordChange: vi.fn(() => false),
    activeSession: vi.fn(() => ({ tokenType: 'user' })),
    sessionIdentity: vi.fn(),
    sessionMatches: vi.fn(() => true),
    markExpired: vi.fn(),
  };
  const api = { validateToken: vi.fn() };
  const router = { createUrlTree: vi.fn((parts: string[]) => ({ redirect: parts[0] })) };

  beforeEach(() => {
    vi.clearAllMocks();
    api.validateToken.mockReset();
    auth.hasPersistedSession.mockReturnValue(true);
    auth.requiresPasswordChange.mockReturnValue(false);
    auth.activeSession.mockReturnValue({ tokenType: 'user' });
    auth.sessionMatches.mockReturnValue(true);
    const identity = {};
    auth.sessionIdentity.mockImplementation(() => identity);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: auth },
        { provide: ApiClient, useValue: api },
        { provide: SessionRefreshService, useValue: { refreshSession: vi.fn() } },
        { provide: Router, useValue: router },
        SyncStatusService,
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('allows the explicitly offline-capable triage route for an unexpired responder', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toBe(true);
    expect(api.validateToken).not.toHaveBeenCalled();
  });

  it.each(['admin', 'leitstelle'] as const)(
    'fails closed for an online %s network error',
    async (tokenType) => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      auth.activeSession.mockReturnValue({ tokenType });
      api.validateToken.mockReturnValue(throwError(() => new TypeError('network')));
      const guard = routes.find((route) => route.path === 'teams')!
        .canActivate![0] as CanActivateFn;

      expect(await run(guard, '/teams')).toEqual({ redirect: '/admin/login' });
      expect(auth.markExpired).toHaveBeenCalledOnce();
    },
  );

  it('keeps administrative sessions on the admin login surface after a shared-route transport failure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({ tokenType: 'admin' });
    api.validateToken.mockReturnValue(throwError(() => new TypeError('network')));
    const guard = routes.find((route) => route.path === 'situation-room')!
      .canActivate![0] as CanActivateFn;

    expect(await run(guard, '/situation-room')).toEqual({ redirect: '/admin/login' });
    expect(auth.markExpired).toHaveBeenCalledOnce();
  });

  it('keeps an online responder workspace during a validation transport failure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    api.validateToken.mockReturnValue(throwError(() => new TypeError('network')));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toBe(true);
    expect(auth.markExpired).not.toHaveBeenCalled();
  });

  it('marks retained responder access as degraded and clears it after one successful retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    const sync = TestBed.inject(SyncStatusService);

    expect(await run(guard, '/triage')).toBe(true);
    expect(sync.validationDegraded()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.validateToken).toHaveBeenCalledTimes(2);
    expect(sync.validationDegraded()).toBe(false);
    vi.useRealTimers();
  });

  it('retries retained responder validation after a second transport failure', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    const sync = TestBed.inject(SyncStatusService);

    expect(await run(guard, '/triage')).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.validateToken).toHaveBeenCalledTimes(2);
    expect(sync.validationDegraded()).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.validateToken).toHaveBeenCalledTimes(3);
    expect(sync.validationDegraded()).toBe(false);
    vi.useRealTimers();
  });

  it('clears degraded validation state when the next validation is denied', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const sync = TestBed.inject(SyncStatusService);
    sync.markValidationDegraded();
    api.validateToken.mockReturnValue(throwError(() => new ApiRequestError(403, null)));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toEqual({ redirect: '/login' });
    expect(sync.validationDegraded()).toBe(false);
    expect(auth.markExpired).toHaveBeenCalledOnce();
  });

  it('expires a retained responder when the bounded retry later receives 401', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(throwError(() => new ApiRequestError(401, null)));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    const sync = TestBed.inject(SyncStatusService);

    expect(await run(guard, '/triage')).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sync.validationDegraded()).toBe(false);
    expect(auth.markExpired).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it.each(['user', 'qr'] as const)(
    'expires an online token-only %s session when validation rejects it',
    async (tokenType) => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      auth.activeSession.mockReturnValue({ token: 'access-token', tokenType });
      api.validateToken.mockReturnValue(throwError(() => new ApiRequestError(401, null)));
      const refresh = TestBed.inject(SessionRefreshService) as any;
      refresh.refreshSession.mockReturnValue(throwError(() => new TypeError('network')));
      const guard = routes.find((route) => route.path === 'triage')!
        .canActivate![0] as CanActivateFn;

      expect(await run(guard, '/triage')).toEqual({ redirect: '/login' });
      expect(refresh.refreshSession).not.toHaveBeenCalled();
      expect(auth.markExpired).toHaveBeenCalledOnce();
    },
  );

  it('expires a responder when validation and refresh both reject the session', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'access-token',
      tokenType: 'user',
      refreshToken: 'refresh-token',
    });
    api.validateToken.mockReturnValue(throwError(() => new ApiRequestError(401, null)));
    const refresh = TestBed.inject(SessionRefreshService) as any;
    refresh.refreshSession.mockReturnValue(throwError(() => new ApiRequestError(401, null)));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toEqual({ redirect: '/login' });
    expect(refresh.refreshSession).toHaveBeenCalledOnce();
    expect(auth.markExpired).toHaveBeenCalledOnce();
  });

  it('expires the same session when validation rejects directly with 403', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    api.validateToken.mockReturnValue(throwError(() => new ApiRequestError(403, null)));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toEqual({ redirect: '/login' });
    expect(auth.markExpired).toHaveBeenCalledOnce();
  });

  it('does not expire a replacement session when a stale refresh fails', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    let session = { tokenType: 'user' as const, refreshToken: 'refresh-a' };
    const refreshResult = new Subject<void>();
    auth.activeSession.mockImplementation(() => session);
    api.validateToken.mockReturnValue(throwError(() => new ApiRequestError(401, null)));
    const refresh = TestBed.inject(SessionRefreshService) as any;
    refresh.refreshSession.mockReturnValue(refreshResult);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    const result = run(guard, '/triage');
    session = { tokenType: 'user', refreshToken: 'refresh-b' };
    auth.sessionIdentity.mockReturnValue({});
    refreshResult.error(new ApiRequestError(401, null));

    expect(await result).toEqual({ redirect: '/login' });
    expect(auth.markExpired).not.toHaveBeenCalled();
  });

  it('does not authorize or expire a token-only replacement session when delayed validation succeeds', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    let session: any = { token: 'token-a', tokenType: 'user' };
    const validation = new Subject<{ role: string }>();
    auth.activeSession.mockImplementation(() => session);
    api.validateToken.mockReturnValue(validation);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    const result = run(guard, '/triage');
    session = { token: 'token-b', tokenType: 'admin' };
    auth.sessionIdentity.mockReturnValue({});
    validation.next({ role: 'user' });
    validation.complete();

    expect(await result).toEqual({ redirect: '/login' });
    expect(auth.markExpired).not.toHaveBeenCalled();
  });

  it('does not expire a replacement session when delayed validation rejects directly', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    let session: any = { token: 'token-a', tokenType: 'user', refreshToken: 'refresh-a' };
    const validation = new Subject<never>();
    auth.activeSession.mockImplementation(() => session);
    api.validateToken.mockReturnValue(validation);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    const result = run(guard, '/triage');
    session = { token: 'token-b', tokenType: 'admin', refreshToken: 'refresh-b' };
    auth.sessionIdentity.mockReturnValue({});
    validation.error(new ApiRequestError(403, null));

    expect(await result).toEqual({ redirect: '/login' });
    expect(auth.markExpired).not.toHaveBeenCalled();
  });

  it('continues to the requested route after refresh rotates both credentials', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'old',
      refreshToken: 'old-refresh',
      tokenType: 'user',
    });
    api.validateToken.mockReturnValueOnce(throwError(() => new ApiRequestError(401, null)));
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const refresh = TestBed.inject(SessionRefreshService) as any;
    refresh.refreshSession.mockImplementation(() => {
      auth.activeSession.mockReturnValue({
        token: 'new',
        refreshToken: 'new-refresh',
        tokenType: 'user',
      });
      return of(undefined);
    });
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toBe(true);
    expect(api.validateToken).toHaveBeenCalledTimes(2);
  });

  it('accepts validation overlapping a background rotation of the same session', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'old',
      refreshToken: 'old-refresh',
      tokenType: 'user',
    });
    const validation = new Subject<{ role: string }>();
    api.validateToken.mockReturnValue(validation);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    const result = run(guard, '/triage');
    auth.activeSession.mockReturnValue({
      token: 'new',
      refreshToken: 'new-refresh',
      tokenType: 'user',
    });
    validation.next({ role: 'user' });
    expect(await result).toBe(true);
  });

  it('keeps the scheduled validation retry through credential rotation', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'old',
      refreshToken: 'old-refresh',
      tokenType: 'user',
    });
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    expect(await run(guard, '/triage')).toBe(true);
    auth.activeSession.mockReturnValue({
      token: 'new',
      refreshToken: 'new-refresh',
      tokenType: 'user',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.validateToken).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(SyncStatusService).validationDegraded()).toBe(false);
  });

  it('revalidates rotated credentials when the degraded retry rejects its older token', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'old',
      refreshToken: 'old-refresh',
      tokenType: 'user',
    });
    const oldValidation = new Subject<never>();
    api.validateToken.mockReturnValueOnce(throwError(() => new TypeError('network')));
    api.validateToken.mockReturnValueOnce(oldValidation);
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    expect(await run(guard, '/triage')).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    auth.activeSession.mockReturnValue({
      token: 'new',
      refreshToken: 'new-refresh',
      tokenType: 'user',
    });
    oldValidation.error(new ApiRequestError(401, null));
    expect(auth.markExpired).not.toHaveBeenCalled();
    expect(api.validateToken).toHaveBeenCalledTimes(3);
    expect(TestBed.inject(SyncStatusService).validationDegraded()).toBe(false);
  });

  it('revalidates an initial 403 received after the same session rotates', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    auth.activeSession.mockReturnValue({
      token: 'old',
      refreshToken: 'old-refresh',
      tokenType: 'user',
    });
    const oldValidation = new Subject<never>();
    api.validateToken.mockReturnValueOnce(oldValidation);
    api.validateToken.mockReturnValueOnce(of({ role: 'user' }));
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;
    const result = run(guard, '/triage');
    auth.activeSession.mockReturnValue({
      token: 'new',
      refreshToken: 'new-refresh',
      tokenType: 'user',
    });
    oldValidation.error(new ApiRequestError(403, null));
    expect(await result).toBe(true);
    expect(auth.markExpired).not.toHaveBeenCalled();
    expect(api.validateToken).toHaveBeenCalledTimes(2);
  });

  it('denies an expired responder before validation', async () => {
    auth.hasPersistedSession.mockReturnValue(false);
    const guard = routes.find((route) => route.path === 'triage')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/triage')).toEqual({ redirect: '/login' });
    expect(api.validateToken).not.toHaveBeenCalled();
  });

  it.each(['admin', 'leitstelle'] as const)('denies an offline %s route', async (tokenType) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    auth.activeSession.mockReturnValue({ tokenType });
    const guard = routes.find((route) => route.path === 'admin')!.canActivate![0] as CanActivateFn;

    expect(await run(guard, '/admin')).toEqual({ redirect: '/admin/login' });
    expect(api.validateToken).not.toHaveBeenCalled();
  });
});

async function run(guard: CanActivateFn, url: string): Promise<unknown> {
  const result = TestBed.runInInjectionContext(() => guard({} as any, { url } as any));
  return isObservable(result) ? firstValueFrom(result) : await Promise.resolve(result);
}
