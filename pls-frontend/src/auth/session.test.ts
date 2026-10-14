import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';
import client from '../api/client';
import { cancelOwnAccess, endSession, PendingWorkError, startSession } from './session';
import { useAuthStore } from '../stores/authStore';
import { STORAGE_KEYS } from '../storage/keys';
import { fakeToken } from '../test/session';
import { clearOfflineQueueForTests, offlineQueue } from '../offline/offlineQueue';
import { createPage1Template } from '../features/ambulanzprotokoll-page1/page1State';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };
let handler: Handler;
const seen: Array<{ url: string; body: unknown }> = [];

let networkDown = false;

const adapter: AxiosAdapter = async (config) => {
  if (networkDown) throw new AxiosError('Network Error', 'ERR_NETWORK', config);
  seen.push({ url: config.url ?? '', body: config.data ? JSON.parse(config.data as string) : undefined });
  const result = handler(config);
  const response = { status: result.status, statusText: '', headers: {}, config, data: result.data };
  if (result.status >= 400) throw new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, response);
  return response;
};

const draft = (owner: string, synced: boolean) => JSON.stringify({ owner, synced, patientId: 1, status: 'draft', updatedAt: null, finalizedAt: null, formState: {} });

beforeEach(async () => {
  await clearOfflineQueueForTests();
  networkDown = false;
  seen.length = 0;
  window.localStorage.clear();
  client.defaults.adapter = adapter;
  axios.defaults.adapter = adapter;
});

describe('session lifecycle (security review M1, M3)', () => {
  it('revokes the refresh token even after the access token expired', async () => {
    useAuthStore.setState({ session: { token: 'expired-access', refreshToken: 'refresh-1', role: 'leitstelle' } });
    handler = (config) => {
      if (config.url === '/api/refresh-token') return { status: 200, data: { token: 'new-access', refreshToken: 'refresh-2' } };
      if (config.url === '/api/logout') return config.headers?.Authorization === 'Bearer new-access' ? { status: 204 } : { status: 401 };
      return { status: 404 };
    };

    await endSession();

    expect(seen.map((s) => s.url)).toEqual(['/api/logout', '/api/refresh-token', '/api/logout']);
    expect(seen[2].body).toEqual({ refreshToken: 'refresh-2' });
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('removes synced drafts when the session ends and keeps unsent ones (no data loss)', async () => {
    useAuthStore.setState({ session: { token: fakeToken('qr', '1'), role: 'qr' } });
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(1, 'qr:1'), draft('qr:1', true));
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(2, 'qr:1'), draft('qr:1', false));
    handler = () => ({ status: 204 });

    await endSession();

    expect(window.localStorage.getItem(STORAGE_KEYS.page1Draft(1, 'qr:1'))).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.page1Draft(2, 'qr:1'))).not.toBeNull();
  });

  it('sends unsent drafts flagged before revoking the session; logout is not blocked (D11)', async () => {
    useAuthStore.setState({ session: { token: fakeToken('user', '1'), refreshToken: 'refresh-1', role: 'user' } });
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(4, 'user:1'), JSON.stringify({
      owner: 'user:1', synced: false, patientId: 4, status: 'draft', updatedAt: '2026-01-01T10:00:00.000Z', finalizedAt: null, formState: createPage1Template(),
    }));
    handler = (config) => (config.url === '/api/persons/4/ambulanzprotokoll-page1'
      ? { status: 200, data: { patientId: 4, status: 'draft', formState: {}, updatedAt: '2026-01-01T10:00:01.000Z' } }
      : { status: 204 });

    await endSession();

    expect(seen.map((s) => s.url)).toEqual(['/api/persons/4/ambulanzprotokoll-page1', '/api/logout']);
    expect(seen[0].body).toMatchObject({ status: 'draft', sentAtLogout: true });
    expect(await offlineQueue.pendingProtocol(4)).toBeNull();
  });

  it('offline at logout: the session still ends, the draft stays queued for the same account', async () => {
    useAuthStore.setState({ session: { token: fakeToken('user', '1'), refreshToken: 'refresh-1', role: 'user' } });
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(4, 'user:1'), JSON.stringify({
      owner: 'user:1', synced: false, patientId: 4, status: 'draft', updatedAt: '2026-01-01T10:00:00.000Z', finalizedAt: null, formState: createPage1Template(),
    }));
    handler = () => ({ status: 0 });
    networkDown = true;

    await endSession();

    expect(useAuthStore.getState().session).toBeNull();
    const items = await offlineQueue.foreignItemIds();
    expect(items).toEqual(['protocol:user:1:4']);
  });

  it('self-cancel stops while work is still unsent after the last send (review 4, M2)', async () => {
    useAuthStore.setState({ session: { token: fakeToken('user', '1'), refreshToken: 'refresh-1', role: 'user' } });
    await offlineQueue.queueTriage(5, { triageColor: 'rot' } as never);
    handler = (config) => (config.url === '/api/persons/5/update-triage-color' ? { status: 400, data: { message: 'nein' } } : { status: 204 });

    await expect(cancelOwnAccess()).rejects.toBeInstanceOf(PendingWorkError);
    expect(seen.map((s) => s.url)).not.toContain('/api/users/self-cancel');
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('at login removes synced drafts of other accounts and keeps their unsent ones hidden', async () => {
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(1, 'qr:1'), draft('qr:1', true));
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(2, 'qr:1'), draft('qr:1', false));
    window.localStorage.setItem(STORAGE_KEYS.page1Draft(3, 'user:9'), draft('user:9', true));

    startSession({ token: fakeToken('user', '9'), role: 'user' });

    expect(window.localStorage.getItem(STORAGE_KEYS.page1Draft(1, 'qr:1'))).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.page1Draft(2, 'qr:1'))).not.toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.page1Draft(3, 'user:9'))).not.toBeNull();
    const { readPage1Draft } = await import('../features/ambulanzprotokoll-page1/page1Storage');
    expect(readPage1Draft(2)).toBeNull();
  });

  it('logs out with the token another tab rotated to, not this tab\'s stale copy', async () => {
    useAuthStore.setState({ session: { token: 'access-1', refreshToken: 'refresh-1', role: 'leitstelle' } });
    // Another tab rotated; this tab has not processed the storage event yet.
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.auth)!);
    persisted.state.session = { ...persisted.state.session, token: 'access-2', refreshToken: 'refresh-2' };
    window.localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(persisted));
    handler = (config) => (config.headers?.Authorization === 'Bearer access-2' ? { status: 204 } : { status: 401 });

    await endSession();

    expect(seen).toEqual([{ url: '/api/logout', body: { refreshToken: 'refresh-2' } }]);
  });
});
