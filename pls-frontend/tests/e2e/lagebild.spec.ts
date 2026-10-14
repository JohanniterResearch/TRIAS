import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

// Parity plan Phase 5 exit: a triage change made on one device appears in another device's
// Lagebild within 2 s over the hub, and within 12 s through polling when the hub is blocked.
// Also teams (WP 5.2) and the Lagebild body map (WP 5.4).

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;
let adminToken: string;
let eventSceneId: number;

async function call<T>(request: APIRequestContext, token: string, method: 'get' | 'post' | 'put', path: string, data?: unknown) {
  const response = await request[method](`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

async function qrToken(request: APIRequestContext): Promise<string> {
  const [code] = await call<Array<{ qrToken: string }>>(request, adminToken, 'post', '/api/login-qr-codes/generate', { number: 1, eventSceneId });
  return code.qrToken;
}

/** A device signed in with a login QR, looking at the Lagebild of the event. */
async function lagebild(browser: Browser, request: APIRequestContext, blockHub = false): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  if (blockHub) await page.route('**/hubs/**', (route) => route.abort());
  await page.goto('/qrAuthenticator');
  await page.getByLabel('DEV: Login-QR-Code').fill(await qrToken(request));
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
  await page.getByLabel('Einsatzort:').selectOption({ label: 'Demo-Event Wien (Veranstaltung)' });
  await page.getByLabel('Funktion:').selectOption('Leitstelle');
  await page.getByRole('button', { name: 'Bestätigen' }).click();
  await expect(page).toHaveURL(/\/SituationRoomTable$/);
  return page;
}

test.beforeAll(async ({ request }) => {
  adminToken = (await (await request.post(`${apiUrl}/api/dev-login`, { data: { role: 'admin' } })).json()).token;
  const scenes = await call<Array<{ id: number; name: string; parentSceneId: number | null }>>(request, adminToken, 'get', '/api/operation-scenes');
  eventSceneId = scenes.find((scene) => scene.name === 'Demo-Event Wien' && scene.parentSceneId == null)!.id;
});

async function triageFromOtherDevice(request: APIRequestContext, color: string): Promise<number> {
  const token = (await call<{ token: string }>(request, '', 'post', '/api/qr-login', { qr_code: await qrToken(request) })).token;
  const patient = await call<{ id: number }>(request, token, 'post', '/api/persons/manual', { operationSceneId: eventSceneId, clientGeneratedId: crypto.randomUUID() });
  await call(request, token, 'post', `/api/persons/${patient.id}/update-triage-color`, { triageColor: color });
  return patient.id;
}

test('live: a triage change on another device appears within 2 s', async ({ browser, request }) => {
  const page = await lagebild(browser, request);
  await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible();

  const patientId = await triageFromOtherDevice(request, 'rot');
  // A new patient arrives as a membership change; then the colour change is pushed.
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Ambulanzprotokoll für Patient ${patientId} öffnen` }) });
  await expect(row).toContainText('rot', { timeout: 2_000 });

  const token = (await call<{ token: string }>(request, '', 'post', '/api/qr-login', { qr_code: await qrToken(request) })).token;
  await call(request, token, 'post', `/api/persons/${patientId}/update-triage-color`, { triageColor: 'gelb' });
  await expect(row).toContainText('gelb', { timeout: 2_000 });
  await page.context().close();
});

test('hub blocked: the change appears through polling within 12 s', async ({ browser, request }) => {
  const page = await lagebild(browser, request, true);
  await expect(page.getByRole('status').filter({ hasText: 'Keine Live-Verbindung' })).toBeVisible();

  const patientId = await triageFromOtherDevice(request, 'schwarz');
  await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: `Ambulanzprotokoll für Patient ${patientId} öffnen` }) })).toContainText('schwarz', { timeout: 12_000 });
  await page.context().close();
});

test('teams: created by the Leitstelle, updated from another device, shown live', async ({ browser, request }) => {
  const staff = await (await browser.newContext()).newPage();
  await staff.goto('/AdminLandingPage');
  await staff.getByRole('button', { name: 'DEV: Skip to Admin Settings' }).click();
  await expect(staff).toHaveURL(/\/AdminSettingsPage$/);
  await staff.evaluate((scene) => {
    localStorage.setItem('pls:ambulanz-v1:work-context', JSON.stringify({ state: { operationSceneId: scene, patientId: null, patientLabel: null }, version: 0 }));
  }, eventSceneId);
  await staff.goto('/SituationRoomTable');
  const name = `Team ${Date.now()}`;
  await staff.getByLabel('Neues Team (Name oder Funkrufname)').fill(name);
  await staff.getByRole('button', { name: 'Team anlegen' }).click();
  await expect(staff.getByRole('cell', { name })).toBeVisible();

  const responder = await lagebild(browser, request);
  await responder.getByLabel(`Status ${name}`).selectOption('busy');
  await expect(staff.getByLabel(`Status ${name}`)).toHaveValue('busy', { timeout: 2_000 });
  // Responders do not create teams.
  await expect(responder.getByRole('button', { name: 'Team anlegen' })).toHaveCount(0);
  await staff.context().close();
  await responder.context().close();
});

test('body map in the Lagebild: codec reverse mapping, heel regions as text', async ({ browser, request }) => {
  const patientId = await triageFromOtherDevice(request, 'gelb');
  await call(request, adminToken, 'put', '/api/body-parts', { idpatient: patientId, bodyPartId: 'bauch_vorne', isClicked: true });
  await call(request, adminToken, 'put', '/api/body-parts', { idpatient: patientId, bodyPartId: 'ferse_links_hinten', isClicked: true });

  const page = await lagebild(browser, request);
  await page.getByLabel('Körperregionen für Patient:In').selectOption(String(patientId));
  const figure = page.getByRole('figure', { name: `Körperregionen Patient ${patientId}` });
  await expect(figure.getByRole('img', { name: /^Vorderseite: leiste_links_vorne, leiste_rechts_vorne$/ })).toBeVisible();
  await expect(figure).toContainText('Weitere markierte Regionen (nicht in der Zeichnung): ferse_links_hinten');
  await page.context().close();
});
