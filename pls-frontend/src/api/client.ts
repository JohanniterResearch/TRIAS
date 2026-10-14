import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { loginPathFor, sessionOwner, useAuthStore, type Session, type SessionRole } from '../stores/authStore';
import { STORAGE_KEYS } from '../storage/keys';

// Paths are the contract paths (`/api/...`, `/health`); Vite and Caddy serve them same-origin.
const client = axios.create({
  // A hung request (captive portal, half-open connection) must not stall the queue or a logout
  // (security review 4, M1); a timeout counts as unreachable and the write is queued.
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Requests that must never trigger a refresh: they authenticate, or they are the refresh itself.
const AUTH_PATHS = ['/api/qr-login', '/api/user-login', '/api/admin-login', '/api/refresh-token', '/api/dev-login', '/api/logout'];

type RetriableConfig = InternalAxiosRequestConfig & { _plsRetried?: boolean };

let sessionExpiredHandler: (loginPath: string) => void = (loginPath) => window.location.assign(loginPath);

/** Lets the app route to the login page instead of reloading (tests replace it too). */
export function setSessionExpiredHandler(handler: (loginPath: string) => void) {
  sessionExpiredHandler = handler;
}

export function expireSession(role: SessionRole | undefined) {
  useAuthStore.getState().clearSession();
  sessionExpiredHandler(loginPathFor(role));
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Send only under this session (`type:sub`): queued work is never sent under another account. */
    expectedOwner?: string;
  }
}

/** A request refused before sending because another session is signed in now. */
export class OwnerMismatchError extends Error {
  constructor() {
    super('Andere Anmeldung aktiv: Eintrag wird nicht gesendet.');
    this.name = 'OwnerMismatchError';
  }
}

client.interceptors.request.use((config) => {
  // Read the token on every attempt, so a retry after refresh carries the new one.
  const token = useAuthStore.getState().session?.token;
  if (config.expectedOwner !== undefined && sessionOwner(token) !== config.expectedOwner) throw new OwnerMismatchError();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshInFlight: { refreshToken: string; promise: Promise<void> } | null = null;

const SESSION_LOCK = `${STORAGE_KEYS.auth}:refresh`;

/**
 * Runs `task` under the cross-tab Web Lock that serializes every use of the shared refresh token
 * (rotation and logout). Without a secure context there is no lock API and it runs directly.
 */
export function withSessionLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request(SESSION_LOCK, task) as unknown as Promise<T>) : task();
}

/** The refresh token as persisted right now, which another tab may have rotated. */
export function persistedRefreshToken(): string | undefined {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.auth) ?? 'null') as { state?: { session?: Session | null } } | null;
    return stored?.state?.session?.refreshToken;
  } catch {
    return undefined;
  }
}

/** Call only inside withSessionLock. */
export async function rotate(refreshToken: string): Promise<void> {
  // Another tab rotated (or logged out) while this one waited for the lock: adopt its result
  // instead of presenting a spent token, which the server answers by revoking every session.
  if (persistedRefreshToken() !== refreshToken) {
    await useAuthStore.persist.rehydrate();
    return;
  }
  const { data } = await axios.post<{ token: string; refreshToken: string }>('/api/refresh-token', { refreshToken });
  // A logout or a login may have replaced the session meanwhile (checked against storage, which
  // other tabs write first). Then nobody holds the new pair: revoke it instead of resurrecting a
  // session the user ended (security review 2, finding 2).
  if (persistedRefreshToken() === refreshToken && useAuthStore.getState().session?.refreshToken === refreshToken) {
    useAuthStore.getState().updateTokens(data.token, data.refreshToken);
  } else {
    void axios
      .post('/api/logout', { refreshToken: data.refreshToken }, { headers: { Authorization: `Bearer ${data.token}` } })
      .catch(() => undefined);
  }
}

/**
 * Rotates the refresh token once, shared by every request that hit a 401 meanwhile. Tabs share one
 * token pair, so the rotation runs under a cross-tab Web Lock where available (security review M2).
 */
export function refreshOnce(refreshToken: string): Promise<void> {
  if (refreshInFlight?.refreshToken === refreshToken) return refreshInFlight.promise;
  const promise = withSessionLock(() => rotate(refreshToken)).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { refreshToken, promise };
  return promise;
}

/** Waits for a running refresh, so the caller sees the token pair it produces. */
export async function settleRefresh(): Promise<void> {
  try {
    await refreshInFlight?.promise;
  } catch {
    // the caller decides with whatever session remains
  }
}

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    if (error.response?.status !== 401 || !config || AUTH_PATHS.includes(config.url ?? '')) {
      return Promise.reject(error);
    }

    const session = useAuthStore.getState().session;
    // A 401 on a retry that already carried a freshly refreshed token refuses this request
    // (for example a wrong current password), not the session.
    if (!session || config._plsRetried) return Promise.reject(error);

    if (session.refreshToken) {
      const sentToken = String(config.headers.Authorization ?? '').replace(/^Bearer /, '');
      try {
        // A newer token already exists (another request or tab refreshed): just retry with it.
        if (sentToken === session.token) await refreshOnce(session.refreshToken);
      } catch (refreshError) {
        // Only a definite refusal of the token this tab still holds ends the session; a network
        // failure keeps it for a retry, and a token another tab rotated meanwhile is still good.
        const stillCurrent = useAuthStore.getState().session?.refreshToken === session.refreshToken;
        if ((refreshError as AxiosError).response?.status === 401 && stillCurrent) expireSession(session.role);
        return Promise.reject(error);
      }
      // Never resend a request under another account: if a login in another tab replaced the
      // session, this request belonged to the previous user (security review 2, finding 1).
      if (sessionOwner(useAuthStore.getState().session?.token) !== sessionOwner(sentToken)) return Promise.reject(error);
      config._plsRetried = true;
      return client(config);
    }

    expireSession(session.role);
    return Promise.reject(error);
  },
);

/** The server's `{status, message}` error text, or the fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as AxiosError<{ message?: unknown }>)?.response?.data;
  return typeof data?.message === 'string' && data.message.length > 0 ? data.message : fallback;
}

export function httpStatus(error: unknown): number | undefined {
  return (error as AxiosError)?.response?.status;
}

/** No HTTP response at all: offline, DNS, connection refused, timeout. */
export function isTransportFailure(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}

/**
 * The server cannot be reached for now: no answer, a timeout, rate limiting, or a gateway error
 * (the proxy is up, the backend is not). Such writes are queued and retried, not refused
 * (security review 4, M5); a plain 500 is a server answer and is shown.
 */
export function isUnavailable(error: unknown): boolean {
  return isTransportFailure(error) || [408, 429, 502, 503, 504].includes(httpStatus(error) ?? 0);
}

export type { AxiosRequestConfig };
export default client;
