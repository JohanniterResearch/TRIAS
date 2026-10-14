import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, expect, it } from 'vitest';
import client from '../api/client';
import { clearOfflineQueueForTests, offlineQueue, sendOrQueue } from './offlineQueue';
import { signIn } from '../test/session';

// The app's queue with the real HTTP transport (axios adapter faked).
type Answer = { status: number; data?: unknown };
let answer: (config: InternalAxiosRequestConfig) => Answer;
const adapter: AxiosAdapter = async (config) => {
  const result = answer(config);
  const response = { status: result.status, statusText: '', headers: {}, config, data: result.data };
  if (result.status >= 400) throw new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, response);
  return response;
};

beforeEach(async () => {
  window.localStorage.clear();
  signIn('qr', '1');
  await clearOfflineQueueForTests();
  client.defaults.adapter = adapter;
});

const finalizedBody = { status: 'finalized' as const, formState: { incident: { ambulanzort: 'Zelt 1' } } };

it('a replayed finalization refused with 403 counts as done when the server holds it (review 4, M3)', async () => {
  answer = (config) => (config.method === 'put'
    ? { status: 403 }
    : { status: 200, data: { patientId: 5, status: 'finalized', updatedAt: '2026-01-01T00:00:00Z', formState: { incident: { ambulanzort: 'Zelt 1', datum: null } } } });
  await offlineQueue.queueProtocol(5, finalizedBody as never);
  await offlineQueue.flush(true);
  expect(offlineQueue.getStatus()).toMatchObject({ pendingCount: 0, blocked: [] });
});

it('a 403 for a finalization the server does not hold stays a refusal', async () => {
  answer = (config) => (config.method === 'put'
    ? { status: 403 }
    : { status: 200, data: { patientId: 5, status: 'finalized', updatedAt: '2026-01-01T00:00:00Z', formState: { incident: { ambulanzort: 'anders' } } } });
  await offlineQueue.queueProtocol(5, finalizedBody as never);
  await offlineQueue.flush(true);
  expect(offlineQueue.getStatus().blocked).toHaveLength(1);
});

it.each([502, 503, 504, 408])('HTTP %i means unreachable: the write is queued, not refused (review 4, M5)', async (status) => {
  answer = () => ({ status });
  const outcome = await sendOrQueue(5, () => client.post('/api/x', {}), () => offlineQueue.queueTriage(5, { triageColor: 'rot' } as never));
  expect(outcome.queued).toBe(true);
});

it('a plain 500 is a server answer and is shown', async () => {
  answer = () => ({ status: 500 });
  await expect(sendOrQueue(5, () => client.post('/api/x', {}), () => offlineQueue.queueTriage(5, { triageColor: 'rot' } as never))).rejects.toBeInstanceOf(AxiosError);
});

it('a write in flight when another account signs in is neither queued nor sent under it (final review, H1)', async () => {
  let release!: () => void;
  const hung = new Promise<void>((resolve) => (release = resolve));
  const send = async () => {
    await hung;
    throw new AxiosError('timeout', 'ECONNABORTED');
  };
  const write = sendOrQueue(5, send, (owner) => offlineQueue.queueTriage(5, { triageColor: 'rot' } as never, owner));
  signIn('qr', '2'); // A logged out, B signed in while A's request hung
  release();
  await expect(write).rejects.toThrow();
  signIn('qr', '1');
  expect(await offlineQueue.pendingFor(5)).toEqual([]);
  signIn('qr', '2');
  expect(await offlineQueue.pendingFor(5)).toEqual([]);
});

it('a change made under one account is refused once another one is signed in (late GPS fix)', async () => {
  let sent = false;
  const outcome = sendOrQueue(5, async () => (sent = true), async () => undefined, 'qr:1');
  signIn('qr', '2');
  await expect(sendOrQueue(5, async () => (sent = true), async () => undefined, 'qr:1')).rejects.toThrow(/Andere Anmeldung/);
  await outcome;
  expect(sent).toBe(true); // the first one ran while its account was still signed in
});
