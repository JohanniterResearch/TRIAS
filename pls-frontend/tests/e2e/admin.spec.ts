import { expect, test, type Browser, type Page } from '@playwright/test';

// Parity plan Phase 2 exit: create an event responder -> generate a login QR -> log in with it ->
// revoke -> the login is refused. Covers both credentials an event gets: the responder account
// (username/password) and the event login QR.

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;
const responder = { username: `e2e-responder-${Date.now()}`, password: 'e2e-Passwort-1' };
const EVENT = 'Demo-Event Wien';

let adminPage: Page;
let adminToken: string;

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.beforeAll(async ({ browser }) => {
  adminPage = await freshPage(browser);
  await adminPage.goto('/AdminLandingPage');
  await adminPage.getByRole('button', { name: 'DEV: Skip to Admin Settings' }).click();
  await expect(adminPage).toHaveURL(/\/AdminSettingsPage$/);
  adminToken = await adminPage.evaluate(() => JSON.parse(localStorage.getItem('pls:ambulanz-v1:auth')!).state.session.token);
});

test.afterAll(async () => {
  await adminPage.context().close();
});

async function loginAsResponder(page: Page) {
  await page.goto('/qrAuthenticator');
  await page.getByRole('button', { name: 'Mit Benutzername anmelden' }).click();
  await page.getByPlaceholder('Benutzername').fill(responder.username);
  await page.getByPlaceholder('Passwort').fill(responder.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
}

async function loginWithQr(page: Page, token: string) {
  await page.goto('/qrAuthenticator');
  await page.getByLabel('DEV: Login-QR-Code').fill(token);
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
}

test('event responder: created by the Admin, logs in, is revoked, login refused', async ({ browser }) => {
  await adminPage.getByRole('button', { name: 'Benutzer erstellen' }).click();
  await adminPage.getByLabel('Rolle:').selectOption('responder');
  await adminPage.getByLabel('Kontotyp:').selectOption('event');
  await adminPage.getByLabel('Veranstaltung:').selectOption({ label: EVENT });
  await adminPage.getByLabel('Benutzername:').fill(responder.username);
  await adminPage.getByLabel('Passwort:', { exact: true }).fill(responder.password);
  await adminPage.getByLabel('Passwort bestätigen:').fill(responder.password);
  await adminPage.getByRole('button', { name: 'Benutzer erstellen' }).click();
  await expect(adminPage.getByText('Einsatzkraft-Benutzer wurde erfolgreich erstellt.')).toBeVisible();

  const device = await freshPage(browser);
  await loginAsResponder(device);
  await expect(device).toHaveURL(/\/RoleSelection$/);
  // Event scope: only the event and its sub-sites are offered.
  // (A closed <select> exposes no ARIA groups in Chromium, so check the DOM.)
  await expect(device.locator(`optgroup[label="${EVENT}"] option`)).toHaveText([`${EVENT} (Veranstaltung)`]);

  await adminPage.goto('/ManageUsersPage');
  await adminPage.getByRole('searchbox').fill(responder.username);
  const row = adminPage.getByRole('row', { name: new RegExp(responder.username) });
  await expect(row).toContainText(`Veranstaltung: ${EVENT}`);
  adminPage.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Zugang beenden' }).click();
  await expect(adminPage.getByText(`Zugang von ${responder.username} wurde beendet.`)).toBeVisible();
  await expect(row).toContainText('beendet');

  // The revoked account no longer reads data, and cannot sign in again.
  const refused = await device.request.get(`${apiUrl}/api/operation-scenes`, {
    headers: { Authorization: `Bearer ${await device.evaluate(() => JSON.parse(localStorage.getItem('pls:ambulanz-v1:auth')!).state.session.token)}` },
  });
  expect(refused.status()).toBe(401);
  await device.evaluate(() => localStorage.clear());
  await loginAsResponder(device);
  await expect(device.getByRole('alert')).toHaveText('Benutzername oder Passwort ist falsch.');
  await device.context().close();
});

test('event login QR: generated per event, logs in, is revoked, login refused', async ({ browser, request }) => {
  await adminPage.goto('/CreateLoginQrCodesPage');
  await adminPage.getByLabel('Veranstaltung').selectOption({ label: EVENT });
  await adminPage.getByLabel('Anzahl').fill('1');
  await adminPage.getByRole('button', { name: 'QR-Codes generieren' }).click();
  await expect(adminPage.getByText(`Login-QR · ${EVENT}`)).toBeVisible();
  // The print sheet labels the code with its SHA-256, never with the token itself.
  const label = (await adminPage.getByTestId('qr-sha256').innerText()).trim();
  expect(label).toMatch(/^[0-9a-f]{64}$/);

  // The token is only inside the QR image; read it the way a scanner would get it: from the API.
  const codes = await (await request.get(`${apiUrl}/api/login-qr-codes?unusedOnly=true`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
  const code = (codes as Array<{ id: number; qrToken: string }>).at(-1)!;
  const digest = await adminPage.evaluate(async (token) => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }, code.qrToken);
  expect(digest).toBe(label);
  await expect(adminPage.locator('body')).not.toContainText(code.qrToken);

  const device = await freshPage(browser);
  await loginWithQr(device, code.qrToken);
  await expect(device).toHaveURL(/\/RoleSelection$/);

  await adminPage.goto('/ShowUnusedLoginQrCodesPage');
  await adminPage.getByLabel('Nur unbenutzte').uncheck();
  const row = adminPage.getByRole('row').filter({ has: adminPage.getByRole('cell', { name: String(code.id), exact: true }) });
  await expect(row).toContainText('aktiv bis');
  adminPage.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Widerrufen' }).click();
  await expect(adminPage.getByText('Login-QR-Code wurde widerrufen.')).toBeVisible();
  await expect(row).toContainText('widerrufen');

  await device.evaluate(() => localStorage.clear());
  await loginWithQr(device, code.qrToken);
  await expect(device.getByRole('alert')).toHaveText('QR-Code ungültig, widerrufen oder abgelaufen.');
  await device.context().close();
});

test('Admin corrects a patient: reason required, codec body map, new QR printed once (WP 5.3)', async ({ request }) => {
  const scenes = await (await request.get(`${apiUrl}/api/operation-scenes`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
  const eventId = (scenes as Array<{ id: number; name: string; parentSceneId: number | null }>).find((s) => s.name === EVENT && s.parentSceneId == null)!.id;
  const created = await (await request.post(`${apiUrl}/api/persons/manual`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { operationSceneId: eventId, clientGeneratedId: crypto.randomUUID() },
  })).json();
  const number = created.humanReadableId as string;

  await adminPage.goto('/AdminPatientsPage');
  await adminPage.getByLabel('ID, Nummer oder Name').fill(number);
  await adminPage.getByRole('button', { name: 'Suchen' }).click();
  await adminPage.getByRole('row', { name: new RegExp(number) }).getByRole('button', { name: 'Öffnen' }).click();

  await adminPage.getByLabel('Triagefarbe').selectOption('rot');
  await expect(adminPage.getByRole('button', { name: 'Angaben korrigieren' })).toBeDisabled();
  await adminPage.getByLabel('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)').fill('Nachtriage durch Arzt');
  await adminPage.getByRole('button', { name: 'Angaben korrigieren' }).click();
  await expect(adminPage.getByText('Korrektur gespeichert.')).toBeVisible();

  await adminPage.getByLabel('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)').fill('Bauchverletzung ergänzt');
  await adminPage.locator('#leiste_rechts_vorne').click();
  await adminPage.getByRole('button', { name: 'Körperregionen korrigieren' }).click();
  await expect(adminPage.getByText('Körperregionen korrigiert.')).toBeVisible();
  await expect(adminPage.locator('#leiste_links_vorne')).toHaveCSS('fill', 'rgb(255, 0, 0)');

  await adminPage.getByLabel('Zuordnen').selectOption('new');
  await adminPage.getByRole('button', { name: 'QR-Code zuordnen' }).click();
  await expect(adminPage.getByText('Der neue QR-Code wird nur jetzt angezeigt. Bitte drucken.')).toBeVisible();
  await expect(adminPage.getByTestId('qr-sha256')).toHaveText(/^[0-9a-f]{64}$/);

  const auth = { headers: { Authorization: `Bearer ${adminToken}` } };
  const persons = await (await request.get(`${apiUrl}/api/persons?operationSceneId=${eventId}`, auth)).json();
  expect((persons as Array<{ id: number; triagefarbe: string; qrCodeBound: boolean }>).find((p) => p.id === created.id)).toMatchObject({ triagefarbe: 'rot', qrCodeBound: true });
  const regions = (await (await request.get(`${apiUrl}/api/body-parts?idpatient=${created.id}`, auth)).json()).bodyParts;
  expect(regions.bauch_vorne).toBe(1);
  const audit = await (await request.get(`${apiUrl}/api/audit?patientId=${created.id}&action=write&pageSize=100`, auth)).json();
  const reasons = (audit.entries as Array<{ reason: string | null }>).map((entry) => entry.reason);
  expect(reasons).toEqual(expect.arrayContaining(['Nachtriage durch Arzt', 'Bauchverletzung ergänzt']));
});
