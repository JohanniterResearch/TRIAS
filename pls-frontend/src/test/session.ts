import { useAuthStore, type Session } from '../stores/authStore';

/** Unsigned JWT with the claims the client reads (type, sub); the server is mocked in tests. */
export function fakeToken(type: string, sub: string, nonce = ''): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'none' })}.${encode({ type, sub, jti: nonce })}.`;
}

/** Signs a test session in and returns its owner tag for seeded drafts. */
export function signIn(type: Session['role'] = 'qr', sub = '1', extra: Partial<Session> = {}): string {
  useAuthStore.setState({ session: { token: fakeToken(type, sub), role: type, ...extra } });
  return `${type}:${sub}`;
}
