import { TestBed } from '@angular/core/testing';

import { AuthStore } from './auth.store';

describe('AuthStore session matching', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
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
