import { expect, test, type APIRequestContext } from '@playwright/test';

// Parity plan Phase 3 exit criteria against the real backend: per-field merge of concurrent flag
// edits, older clientUpdatedAt never wins, manual-patient replay is idempotent; plus the manual
// patient, flags and QR reassignment in the UI.

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;
let adminToken: string;
let eventSceneId: number;

async function call<T>(request: APIRequestContext, token: string, method: 'get' | 'post', path: string, data?: unknown) {
  const response = await request[method](`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), `${method} ${path} -> ${response.status()}`).toBe(true);
  return { status: response.status(), body: (await response.json()) as T };
}

/** A separate device: its own QR login for the event. */
async function device(request: APIRequestContext): Promise<string> {
  const [code] = (await call<Array<{ qrToken: string }>>(request, adminToken, 'post', '/api/login-qr-codes/generate', { number: 1, eventSceneId })).body;
  return (await call<{ token: string }>(request, '', 'post', '/api/qr-login', { qr_code: code.qrToken })).body.token;
}

type Person = { id: number; humanReadableId: string | null; transport: boolean | null; kontaminiert: boolean | null; triagefarbe: string | null };

async function person(request: APIRequestContext, id: number): Promise<Person> {
  const { body } = await call<Person[]>(request, adminToken, 'get', `/api/persons?operationSceneId=${eventSceneId}`);
  return body.find((p) => p.id === id)!;
}

test.beforeAll(async ({ request }) => {
  const login = await request.post(`${apiUrl}/api/dev-login`, { data: { role: 'admin' } });
  adminToken = (await login.json()).token;
  const scenes = (await call<Array<{ id: number; name: string; parentSceneId: number | null }>>(request, adminToken, 'get', '/api/operation-scenes')).body;
  eventSceneId = scenes.find((scene) => scene.name === 'Demo-Event Wien' && scene.parentSceneId == null)!.id;
});

test('replaying a manual-patient id creates exactly one patient', async ({ request }) => {
  const token = await device(request);
  const clientGeneratedId = crypto.randomUUID();
  const first = await call<Person>(request, token, 'post', '/api/persons/manual', { operationSceneId: eventSceneId, clientGeneratedId });
  const replay = await call<Person>(request, token, 'post', '/api/persons/manual', { operationSceneId: eventSceneId, clientGeneratedId });

  expect(first.status).toBe(201);
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(first.body.id);
  expect(first.body.humanReadableId).toBeTruthy();
  const { body: all } = await call<Person[]>(request, adminToken, 'get', `/api/persons?operationSceneId=${eventSceneId}`);
  expect(all.filter((p) => p.id === first.body.id)).toHaveLength(1);
});

test('two devices editing different flags both win; an older edit never overwrites a newer one', async ({ request }) => {
  const [a, b] = [await device(request), await device(request)];
  const { body: patient } = await call<Person>(request, a, 'post', '/api/persons/manual', { operationSceneId: eventSceneId, clientGeneratedId: crypto.randomUUID() });
  // Past instants: the server clamps a future clientUpdatedAt to its own clock.
  const now = Date.now() - 60_000;

  await Promise.all([
    call(request, a, 'post', `/api/persons/${patient.id}/update-triage-color`, { transport: true, clientUpdatedAt: new Date(now).toISOString() }),
    call(request, b, 'post', `/api/persons/${patient.id}/update-triage-color`, { kontaminiert: true, clientUpdatedAt: new Date(now).toISOString() }),
  ]);
  expect(await person(request, patient.id)).toMatchObject({ transport: true, kontaminiert: true });

  // Device B decided earlier but delivers later (offline replay): its older value must lose.
  await call(request, a, 'post', `/api/persons/${patient.id}/update-triage-color`, { triageColor: 'rot', clientUpdatedAt: new Date(now + 20_000).toISOString() });
  await call(request, b, 'post', `/api/persons/${patient.id}/update-triage-color`, { triageColor: 'gelb', clientUpdatedAt: new Date(now + 10_000).toISOString() });
  expect((await person(request, patient.id)).triagefarbe).toBe('rot');
});

test('UI: patient without QR gets a number, flags are stored, a QR code is bound later', async ({ page, request }) => {
  const [tag] = (await call<string[]>(request, adminToken, 'post', '/api/patient-qr-codes/generate', { number: 1 })).body;
  const [loginCode] = (await call<Array<{ qrToken: string }>>(request, adminToken, 'post', '/api/login-qr-codes/generate', { number: 1, eventSceneId })).body;

  await page.goto('/qrAuthenticator');
  await page.getByLabel('DEV: Login-QR-Code').fill(loginCode.qrToken);
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
  await page.getByLabel('Einsatzort:').selectOption({ label: 'Demo-Event Wien (Veranstaltung)' });
  await page.getByLabel('Funktion:').selectOption('Triage');
  await page.getByRole('button', { name: 'Bestätigen' }).click();

  await page.getByRole('button', { name: 'Patient ohne QR' }).click();
  await expect(page).toHaveURL(/\/TriagePage1$/);
  const header = await page.getByText(/Patient:In ID:/).first().innerText();
  const [, id, label] = header.match(/ID: (\d+) · Nr\. (\S+)/)!;

  await page.getByRole('button', { name: /Patient gehfähig/ }).click();
  await expect(page.getByText('Patient wurde mit der Kategorie GRÜN versehen')).toBeVisible();
  // The box changes only once the server stored the flag (no false success, WP 1.6).
  await page.getByLabel('Transport').click();
  await expect(page.getByLabel('Transport')).toBeChecked();

  await page.getByRole('button', { name: 'QR-Code zuordnen' }).click();
  await expect(page.getByRole('heading')).toHaveText(`Neuen QR-Code für Patient:In ${id} scannen`);
  await page.getByLabel('DEV: Patienten-QR-Code').fill(tag);
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
  await expect(page.getByText('QR-Code wurde zugeordnet.')).toBeVisible();
  await expect(page.getByText('Patient wurde mit der Kategorie GRÜN versehen')).toBeVisible();
  await expect(page.getByRole('button', { name: 'QR-Code neu zuordnen' })).toBeVisible();

  const stored = await person(request, Number(id));
  expect(stored).toMatchObject({ humanReadableId: label, transport: true, triagefarbe: 'gruen' });
  // The bound tag now opens this patient.
  const verify = await call<{ patient: { id: number } }>(request, adminToken, 'post', '/api/verify-patient-qr-code', { qr_code: tag, operationSceneId: eventSceneId });
  expect(verify.body.patient.id).toBe(Number(id));
});
