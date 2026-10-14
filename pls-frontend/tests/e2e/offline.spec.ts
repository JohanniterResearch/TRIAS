import { chromium, expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Parity plan Phase 6 exit, ported from the Ambulanzsystem offline suites (app-shell,
// protocol-persistence, triage-flags), against the production build with its service worker:
//  - the app reloads offline;
//  - an offline manual patient with triage, a flag and a protocol syncs to one server patient;
//  - queued work survives a browser restart.

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;
const shellUrl = `http://127.0.0.1:${process.env.PLS_E2E_SHELL_PORT ?? '5175'}`;
test.use({ baseURL: shellUrl });

type ServerPatient = { id: number; triagefarbe: string | null; transport: boolean | null; kontaminiert: boolean | null };

let adminToken: string;
let sceneId: number;

async function call<T>(request: APIRequestContext, token: string, method: 'get' | 'post', path: string, data?: unknown) {
  const response = await request[method](`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

test.beforeAll(async ({ request }) => {
  adminToken = (await (await request.post(`${apiUrl}/api/dev-login`, { data: { role: 'admin' } })).json()).token;
  const scenes = await call<Array<{ id: number; name: string; parentSceneId: number | null }>>(request, adminToken, 'get', '/api/operation-scenes');
  sceneId = scenes.find((scene) => scene.name === 'Demo-Event Wien' && scene.parentSceneId == null)!.id;
});

/** A QR session (the production build has no DEV login fields): token from the API, stored as the app stores it. */
async function signInQr(page: Page, request: APIRequestContext) {
  const [code] = await call<Array<{ qrToken: string }>>(request, adminToken, 'post', '/api/login-qr-codes/generate', { number: 1, eventSceneId: sceneId });
  const { token } = await call<{ token: string }>(request, '', 'post', '/api/qr-login', { qr_code: code.qrToken });
  await page.goto('/qrAuthenticator');
  await page.evaluate(([session, scene]) => {
    localStorage.setItem('pls:ambulanz-v1:auth', JSON.stringify({ state: { session: { token: session, role: 'qr' } }, version: 0 }));
    localStorage.setItem('pls:ambulanz-v1:work-context', JSON.stringify({ state: { operationSceneId: scene, patientId: null, patientLabel: null }, version: 0 }));
  }, [token, sceneId] as const);
}

/** Waits until the service worker controls the page (the shell is cached). */
async function shellReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

async function scenePatients(request: APIRequestContext) {
  return call<ServerPatient[]>(request, adminToken, 'get', `/api/persons?operationSceneId=${sceneId}`);
}

test('app shell: the app reloads offline and opens the responder page', async ({ page, context, request }) => {
  await signInQr(page, request);
  await page.goto('/ScanPatient');
  await shellReady(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bitte einen Patienten QR-Code scannen' })).toBeVisible();
  await expect(page.getByText('Offline: Anmeldung derzeit nicht geprüft')).toBeVisible();
  await context.setOffline(false);

  // The shell cache never holds API, hub or health responses, even after a successful API read.
  await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem('pls:ambulanz-v1:auth')!).state.session.token as string;
    const response = await fetch('/api/operation-scenes', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`api read: ${response.status}`);
    await fetch('/health');
  });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) urls.push(...(await (await caches.open(key)).keys()).map((request) => request.url));
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((url) => /\/(api|hubs)\/|\/health$/.test(new URL(url).pathname))).toEqual([]);
});

test('offline: manual patient, triage, flag and protocol sync to one server patient', async ({ page, context, request }) => {
  const place = `Offline-Zelt ${Date.now()}`;
  await signInQr(page, request);
  await page.goto('/ScanPatient');
  await shellReady(page);
  const before = new Set((await scenePatients(request)).map((patient) => patient.id));

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Patient ohne QR' }).click();
  await expect(page).toHaveURL(/\/TriagePage1$/);
  await expect(page.getByText(/Lokal-\d{6}/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Patient gehfähig (ohne weitere Verletzungen)' }).click();
  await expect(page.getByText('Patient wurde mit der Kategorie GRÜN versehen')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Transport' }).click();
  await expect(page.getByRole('checkbox', { name: 'Transport' })).toBeChecked();

  const provisionalId = await page.evaluate(() => JSON.parse(localStorage.getItem('pls:ambulanz-v1:work-context')!).state.patientId as number);
  expect(provisionalId).toBeLessThan(0);
  await page.goto(`/AmbulanzprotokollPage1/${provisionalId}`);
  await page.getByLabel('Ambulanzort').fill(place);
  await expect(page.getByRole('button', { name: /Sync: [1-9]\d* ungesendet/ })).toBeVisible({ timeout: 5_000 });

  await context.setOffline(false);
  await expect(page.getByRole('button', { name: /Sync: Alles gesendet/ })).toBeVisible({ timeout: 20_000 });

  const created = (await scenePatients(request)).filter((patient) => !before.has(patient.id));
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ triagefarbe: 'gruen', transport: true });
  const protocol = await call<{ formState: { incident: { ambulanzort: string } } }>(request, adminToken, 'get', `/api/persons/${created[0].id}/ambulanzprotokoll-page1`);
  expect(protocol.formState.incident.ambulanzort).toBe(place);
  // The open page and the work context moved to the server id.
  await expect(page).toHaveURL(new RegExp(`/AmbulanzprotokollPage1/${created[0].id}$`));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pls:ambulanz-v1:work-context')!).state.patientId)).toBe(created[0].id);
});

test('queued work survives a browser restart and is sent at the next start', async ({ request }) => {
  const profile = await mkdtemp(join(tmpdir(), 'pls-e2e-profile-'));
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chrome', baseURL: shellUrl });
  let context: BrowserContext | undefined;
  try {
    context = await launch();
    const page = context.pages()[0] ?? (await context.newPage());
    await signInQr(page, request);
    await page.goto('/ScanPatient');
    await shellReady(page);
    const before = new Set((await scenePatients(request)).map((patient) => patient.id));

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Patient ohne QR' }).click();
    await page.getByRole('button', { name: 'Patient gehfähig (ohne weitere Verletzungen)' }).click();
    await page.getByRole('checkbox', { name: 'Kontaminiert' }).click();
    await expect(page.getByRole('checkbox', { name: 'Kontaminiert' })).toBeChecked();
    await context.close();

    context = await launch(); // online again, new browser process
    const restarted = context.pages()[0] ?? (await context.newPage());
    await restarted.goto('/ScanPatient');
    await expect(restarted.getByRole('button', { name: /Sync: Alles gesendet/ })).toBeVisible({ timeout: 20_000 });

    const created = (await scenePatients(request)).filter((patient) => !before.has(patient.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ triagefarbe: 'gruen', kontaminiert: true });
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
