import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import client, { OwnerMismatchError, setSessionExpiredHandler } from './client';
import { useAuthStore, type Session } from '../stores/authStore';
import { STORAGE_KEYS } from '../storage/keys';
import { fakeToken } from '../test/session';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown } | 'network';

let handler: Handler;
const seen: Array<{ url: string; auth: string | undefined }> = [];

// One fake transport for both the API client and the bare axios refresh call.
const adapter: AxiosAdapter = async (config) => {
  seen.push({ url: config.url ?? '', auth: config.headers?.Authorization as string | undefined });
  const result = handler(config);
  if (result === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
  const response = { status: result.status, statusText: '', headers: {}, config, data: result.data };
  if (result.status >= 400) throw new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, response);
  return response;
};

const expired = vi.fn();
const userSession: Session = { token: 'old-access', refreshToken: 'refresh-1', role: 'user' };

beforeEach(() => {
  seen.length = 0;
  client.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
  expired.mockReset();
  setSessionExpiredHandler(expired);
  useAuthStore.setState({ session: { ...userSession } });
});

afterEach(() => {
  window.localStorage.clear();
});

function bearer(config: InternalAxiosRequestConfig) {
  return config.headers?.Authorization as string | undefined;
}

describe('API client sessions (WP 1.3)', () => {
  it('refreshes once on 401 and retries with the new token', async () => {
    handler = (config) => {
      if (config.url === '/api/refresh-token') return { status: 200, data: { token: 'new-access', refreshToken: 'refresh-2' } };
      return bearer(config) === 'Bearer new-access' ? { status: 200, data: 'ok' } : { status: 401 };
    };

    const response = await client.get('/api/persons');

    expect(response.data).toBe('ok');
    expect(useAuthStore.getState().session).toMatchObject({ token: 'new-access', refreshToken: 'refresh-2' });
    expect(seen.map((s) => s.url)).toEqual(['/api/persons', '/api/refresh-token', '/api/persons']);
  });

  it('shares one refresh between concurrent 401s (refresh tokens are single-use)', async () => {
    handler = (config) => {
      if (config.url === '/api/refresh-token') return { status: 200, data: { token: 'new-access', refreshToken: 'refresh-2' } };
      return bearer(config) === 'Bearer new-access' ? { status: 200 } : { status: 401 };
    };

    await Promise.all([client.get('/api/persons'), client.get('/api/operation-scenes')]);

    expect(seen.filter((s) => s.url === '/api/refresh-token')).toHaveLength(1);
  });

  it('ends the session when the refresh is refused', async () => {
    handler = () => ({ status: 401 });

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(useAuthStore.getState().session).toBeNull();
    expect(expired).toHaveBeenCalledWith('/qrAuthenticator');
  });

  it('adopts a rotation another tab made instead of presenting the spent token (review M2)', async () => {
    // The other tab wrote the new pair to storage; this tab has not seen the storage event yet.
    window.localStorage.setItem(
      STORAGE_KEYS.auth,
      JSON.stringify({ state: { session: { ...userSession, token: 'new-access', refreshToken: 'refresh-2' } }, version: 0 }),
    );
    handler = (config) => (bearer(config) === 'Bearer new-access' ? { status: 200, data: 'ok' } : { status: 401 });

    const response = await client.get('/api/persons');

    expect(response.data).toBe('ok');
    expect(seen.some((s) => s.url === '/api/refresh-token')).toBe(false);
    expect(useAuthStore.getState().session?.refreshToken).toBe('refresh-2');
  });

  it('keeps the session when a refused token was already rotated by another tab (review M2)', async () => {
    handler = (config) => {
      if (config.url === '/api/refresh-token') {
        useAuthStore.getState().updateTokens('other-tab-access', 'refresh-3');
        return { status: 401 };
      }
      return { status: 401 };
    };

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(expired).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session?.refreshToken).toBe('refresh-3');
  });

  it('never resends a request under another account (review 2, finding 1)', async () => {
    useAuthStore.setState({ session: { token: fakeToken('user', '1'), refreshToken: 'refresh-1', role: 'user' } });
    const other = { token: fakeToken('user', '2'), refreshToken: 'refresh-other', role: 'user' as const };
    // Another account signed in on this device (another tab) while the request was in flight.
    window.localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify({ state: { session: other }, version: 0 }));
    handler = (config) => (config.url === '/api/persons' && bearer(config) === `Bearer ${other.token}` ? { status: 200 } : { status: 401 });

    await expect(client.put('/api/persons', { mine: true })).rejects.toBeInstanceOf(AxiosError);

    expect(seen.filter((s) => s.url === '/api/persons')).toHaveLength(1);
  });

  it('revokes a pair it obtained after the session ended meanwhile (review 2, finding 2)', async () => {
    handler = (config) => {
      if (config.url === '/api/refresh-token') {
        window.localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify({ state: { session: null }, version: 0 })); // logout elsewhere
        return { status: 200, data: { token: 'orphan-access', refreshToken: 'orphan-refresh' } };
      }
      if (config.url === '/api/logout') return { status: 204 };
      return { status: 401 };
    };

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);
    await vi.waitFor(() => expect(seen.some((s) => s.url === '/api/logout' && s.auth === 'Bearer orphan-access')).toBe(true));
    expect(useAuthStore.getState().session?.refreshToken).not.toBe('orphan-refresh');
  });

  it('keeps the session when the refresh fails on the network', async () => {
    handler = (config) => (config.url === '/api/refresh-token' ? 'network' : { status: 401 });

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(useAuthStore.getState().session).not.toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });

  it('sends a QR session back to the QR login on 401 (no refresh token)', async () => {
    useAuthStore.setState({ session: { token: 'qr-token', role: 'qr', eventSceneId: 4 } });
    handler = () => ({ status: 401 });

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(seen.some((s) => s.url === '/api/refresh-token')).toBe(false);
    expect(expired).toHaveBeenCalledWith('/qrAuthenticator');
  });

  it('sends staff back to the admin login', async () => {
    useAuthStore.setState({ session: { token: 't', role: 'leitstelle' } });
    handler = () => ({ status: 401 });

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(expired).toHaveBeenCalledWith('/AdminLandingPage');
  });

  it('never refreshes for the login endpoints themselves', async () => {
    handler = () => ({ status: 401 });

    await expect(client.post('/api/user-login', {})).rejects.toBeInstanceOf(AxiosError);

    expect(seen.map((s) => s.url)).toEqual(['/api/user-login']);
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('treats a 401 after a successful refresh as a refusal of the request, not of the session', async () => {
    handler = (config) =>
      config.url === '/api/refresh-token'
        ? { status: 200, data: { token: 'new-access', refreshToken: 'refresh-2' } }
        : { status: 401, data: { status: 'error', message: 'wrong password' } };

    await expect(client.post('/api/users/change-password', {})).rejects.toBeInstanceOf(AxiosError);

    expect(useAuthStore.getState().session?.token).toBe('new-access');
    expect(expired).not.toHaveBeenCalled();
  });

  it('retries with a token another tab already refreshed instead of spending a refresh', async () => {
    handler = (config) => {
      if (config.url === '/api/refresh-token') return { status: 500 };
      if (bearer(config) === 'Bearer old-access') {
        // Meanwhile another tab rotated the session.
        useAuthStore.setState({ session: { ...userSession, token: 'tab-access', refreshToken: 'refresh-tab' } });
        return { status: 401 };
      }
      return { status: 200 };
    };

    await client.get('/api/persons');

    expect(seen.some((s) => s.url === '/api/refresh-token')).toBe(false);
    expect(seen.at(-1)?.auth).toBe('Bearer tab-access');
  });

  it('passes a 403 through without touching the session', async () => {
    handler = () => ({ status: 403 });

    await expect(client.get('/api/persons')).rejects.toBeInstanceOf(AxiosError);

    expect(useAuthStore.getState().session).not.toBeNull();
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('expectedOwner (offline queue, WP 6.3)', () => {
  it('sends under the expected session and refuses, before sending, under another one', async () => {
    useAuthStore.setState({ session: { token: fakeToken('qr', '1'), role: 'qr' } });
    handler = () => ({ status: 200, data: {} });
    await client.post('/api/x', {}, { expectedOwner: 'qr:1' });
    expect(seen).toHaveLength(1);

    await expect(client.post('/api/x', {}, { expectedOwner: 'qr:2' })).rejects.toBeInstanceOf(OwnerMismatchError);
    useAuthStore.setState({ session: null });
    await expect(client.post('/api/x', {}, { expectedOwner: 'qr:1' })).rejects.toBeInstanceOf(OwnerMismatchError);
    expect(seen).toHaveLength(1);
  });
});
