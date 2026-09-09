import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { ApiClient, ApiRequestError } from '../api/api-client';
import { AuthStore } from './auth.store';
import { SessionRefreshService } from './session-refresh.service';

describe('SessionRefreshService', () => {
  it('shares one in-flight token rotation with all callers', () => {
    const identity = {};
    const response = new Subject<void>();
    const api = { refreshSession: vi.fn(() => response.asObservable()) };
    TestBed.configureTestingModule({
      providers: [
        SessionRefreshService,
        { provide: ApiClient, useValue: api },
        {
          provide: AuthStore,
          useValue: {
            activeSession: () => ({ refreshToken: 'refresh-a', tokenType: 'user' }),
            tokenExpiresAt: () => null,
            sessionIdentity: () => identity,
            markExpired: vi.fn(),
          },
        },
      ],
    });
    const service = TestBed.inject(SessionRefreshService);

    const first = service.refreshSession().subscribe();
    const second = service.refreshSession().subscribe();

    expect(api.refreshSession).toHaveBeenCalledOnce();
    response.next();
    response.complete();
    first.unsubscribe();
    second.unsubscribe();
  });

  it('starts an independent refresh when the active session changes', () => {
    const identity = {};
    const firstResponse = new Subject<void>();
    const secondResponse = new Subject<void>();
    const api = {
      refreshSession: vi
        .fn()
        .mockReturnValueOnce(firstResponse.asObservable())
        .mockReturnValueOnce(secondResponse.asObservable()),
    };
    let session = { refreshToken: 'refresh-a', tokenType: 'user' };
    TestBed.configureTestingModule({
      providers: [
        SessionRefreshService,
        { provide: ApiClient, useValue: api },
        {
          provide: AuthStore,
          useValue: {
            activeSession: () => session,
            tokenExpiresAt: () => null,
            sessionIdentity: () => identity,
            markExpired: vi.fn(),
          },
        },
      ],
    });
    const service = TestBed.inject(SessionRefreshService);

    service.refreshSession().subscribe({ error: () => undefined });
    session = { refreshToken: 'refresh-b', tokenType: 'user' };
    service.refreshSession().subscribe();

    expect(api.refreshSession).toHaveBeenCalledTimes(2);
    firstResponse.error(new Error('refresh-a failed'));
    service.refreshSession().subscribe();
    expect(api.refreshSession).toHaveBeenCalledTimes(2);
    secondResponse.complete();
  });

  it('ignores token-only expiry owned by an earlier session', () => {
    const auth = {
      activeSession: () => ({ tokenType: 'qr' }),
      tokenExpiresAt: () => null,
      sessionIdentity: () => currentIdentity,
      markExpired: vi.fn(),
    };
    let currentIdentity = {};
    const previousIdentity = currentIdentity;
    TestBed.configureTestingModule({
      providers: [
        SessionRefreshService,
        { provide: ApiClient, useValue: {} },
        { provide: AuthStore, useValue: auth },
      ],
    });
    const service = TestBed.inject(SessionRefreshService);
    currentIdentity = {};
    (service as any).expireSession(previousIdentity);
    expect(auth.markExpired).not.toHaveBeenCalled();
  });

  it('does not expire or redirect a replacement session after a stale refresh 401', () => {
    const identity = {};
    const response = new Subject<void>();
    const api = { refreshSession: vi.fn(() => response.asObservable()) };
    let session = { refreshToken: 'refresh-a', tokenType: 'user' };
    const auth = {
      activeSession: () => session,
      tokenExpiresAt: () => null,
      sessionIdentity: () => identity,
      markExpired: vi.fn(),
    };
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    TestBed.configureTestingModule({
      providers: [
        SessionRefreshService,
        { provide: ApiClient, useValue: api },
        { provide: AuthStore, useValue: auth },
      ],
    });
    const service = TestBed.inject(SessionRefreshService);

    (service as any).triggerRefresh();
    session = { refreshToken: 'refresh-b', tokenType: 'user' };
    response.error(new ApiRequestError(401, null));

    expect(auth.markExpired).not.toHaveBeenCalled();
    expect(session).toEqual({ refreshToken: 'refresh-b', tokenType: 'user' });
    expect(assign).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
