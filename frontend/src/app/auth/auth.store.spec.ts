import { TestBed } from '@angular/core/testing';

import { AuthStore } from './auth.store';

describe('AuthStore session matching', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  it('retains in-memory identity across rotation, replacing it on install, expiry and clear', () => {
    const auth = TestBed.inject(AuthStore);
    const initial = auth.sessionIdentity();
    auth.setResponderSession({ token: 'first', refreshToken: 'first-refresh', tokenType: 'user' });
    const installed = auth.sessionIdentity();
    expect(installed).not.toBe(initial);
    auth.refreshTokens('second', 'second-refresh');
    expect(auth.sessionIdentity()).toBe(installed);
    expect(localStorage.getItem('ambulanzsystem.auth.v1')).not.toContain('identity');
    auth.markExpired();
    const expired = auth.sessionIdentity();
    expect(expired).not.toBe(installed);
    auth.setAdminSession({ token: 'admin', tokenType: 'admin' });
    const replaced = auth.sessionIdentity();
    expect(replaced).not.toBe(expired);
    auth.clear();
    expect(auth.sessionIdentity()).not.toBe(replaced);
  });

  it.each(['user', 'qr'] as const)(
    'rejects an unflagged expired %s JWT for responder/QR access',
    (tokenType) => {
      const auth = TestBed.inject(AuthStore);
      auth.setResponderSession({
        token: jwtWithExpiry(Date.now() - 1_000),
        tokenType,
      });

      expect(auth.hasPersistedSession('responder-or-qr')).toBe(false);
    },
  );
});

function jwtWithExpiry(expiresAt: number): string {
  const encoded = btoa(JSON.stringify({ exp: Math.floor(expiresAt / 1_000) }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${encoded}.signature`;
}
