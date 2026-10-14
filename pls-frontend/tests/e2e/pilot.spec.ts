import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Parity plan Phase 1 exit: the PLS pilot flow on the Ambulanzsystem backend.
// QR login -> scene -> scan -> START -> GPS -> body map -> protocol draft -> finalize -> Lagebild.

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;

interface Fixture {
  adminToken: string;
  eventSceneId: number;
  loginQr: string;
  patientQr: string;
}

let fixture: Fixture;
let patientId: number;

async function devAdminToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${apiUrl}/api/dev-login`, { data: { role: 'admin' } });
  expect(response.status()).toBe(200);
  return (await response.json()).token;
}

async function api<T>(request: APIRequestContext, method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
  const response = await request[method](`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${fixture.adminToken}` },
    data,
  });
  expect(response.ok(), `${method} ${path} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

test.beforeAll(async ({ request }) => {
  const adminToken = await devAdminToken(request);
  fixture = { adminToken, eventSceneId: 0, loginQr: '', patientQr: '' };
  const scenes = await api<Array<{ id: number; name: string; parentSceneId: number | null }>>(request, 'get', '/api/operation-scenes');
  const event = scenes.find((scene) => scene.name === 'Demo-Event Wien' && scene.parentSceneId == null);
  expect(event, 'dev seed event').toBeTruthy();
  fixture.eventSceneId = event!.id;
  const loginCodes = await api<Array<{ qrToken: string }>>(request, 'post', '/api/login-qr-codes/generate', {
    number: 1,
    eventSceneId: event!.id,
  });
  fixture.loginQr = loginCodes[0].qrToken;
  const patientCodes = await api<string[]>(request, 'post', '/api/patient-qr-codes/generate', { number: 1 });
  fixture.patientQr = patientCodes[0];
});

async function loginWithQr(page: Page) {
  await page.goto('/qrAuthenticator');
  await page.getByLabel('DEV: Login-QR-Code').fill(fixture.loginQr);
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
  await expect(page).toHaveURL(/\/RoleSelection$/);
}

async function chooseScene(page: Page, role: 'Triage' | 'Leitstelle') {
  await page.getByLabel('Einsatzort:').selectOption({ label: 'Demo-Event Wien (Veranstaltung)' });
  await page.getByLabel('Funktion:').selectOption(role);
  await page.getByRole('button', { name: 'Bestätigen' }).click();
}

test('pilot flow: QR login to finalized protocol, visible in the Lagebild', async ({ page, context, request }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 48.2082, longitude: 16.3738, accuracy: 8 });

  await loginWithQr(page);
  await chooseScene(page, 'Triage');
  await expect(page).toHaveURL(/\/ScanPatient$/);

  await page.getByLabel('DEV: Patienten-QR-Code').fill(fixture.patientQr);
  await page.getByRole('button', { name: 'QR-Code verwenden' }).click();
  await expect(page).toHaveURL(/\/TriagePage1$/);
  patientId = Number((await page.getByText(/Patient:In ID:/).first().innerText()).match(/(\d+)/)![1]);
  expect(patientId).toBeGreaterThan(0);

  // Automatic GPS capture after the scan.
  await expect(page.getByText('GPS: gespeichert')).toBeVisible();

  // START: not walking -> breathing sufficient -> bleeding controllable = gelb.
  await page.getByRole('button', { name: /Patient nicht gehfähig/ }).click();
  await expect(page).toHaveURL(/\/TriagePage2$/);
  await page.getByRole('button', { name: 'Atmung suffizient', exact: true }).click();
  await expect(page).toHaveURL(/\/TriagePage3$/);
  await page.getByRole('button', { name: 'Blutung Stillbar' }).click();
  await expect(page.getByText('Patient wurde mit der Kategorie Gelb versehen')).toBeVisible();

  // Body map through the codec: leiste maps to bauch_vorne and marks both regions (D10).
  await page.getByRole('button', { name: /Körper markieren/ }).click();
  await expect(page).toHaveURL(/\/ShowBodyFront$/);
  await page.locator('#leiste_links_vorne').click();
  await expect(page.locator('#leiste_rechts_vorne')).toHaveCSS('fill', 'rgb(255, 0, 0)');
  await page.getByRole('button', { name: 'Zurück zur Triage' }).click();
  await expect(page.getByText('Patient wurde mit der Kategorie Gelb versehen')).toBeVisible();

  // Lagebild (read-only for QR sessions, D8) -> protocol.
  await page.goto('/RoleSelection');
  await chooseScene(page, 'Leitstelle');
  await expect(page).toHaveURL(/\/SituationRoomTable$/);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: `Ambulanzprotokoll für Patient ${patientId} öffnen` }) });
  await expect(row).toContainText('gelb');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/AmbulanzprotokollPage1/${patientId}$`));

  // Protocol draft with values that must cross the value codec.
  await page.getByLabel('Ambulanzort').fill('Pilot Wien');
  await page.getByLabel('Patient - Familienname').fill('Pilot');
  // The paper-style checkbox is drawn by its label; click the label like a user does.
  for (const option of ['Apnoe', 'Extremität']) {
    await page.locator('label.ambd-option', { hasText: new RegExp(`^${option}$`) }).click();
    await expect(page.getByLabel(option)).toBeChecked();
  }
  await expect(page.getByText('Sync: saved-server')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'Finalisieren' }).click();
  await expect(page.getByText('Status: finalized')).toBeVisible();

  // Server state, read as admin.
  const persons = await api<Array<{ id: number; triagefarbe: string; latitudePatient: number | null; atmung: boolean; blutung: boolean }>>(
    request,
    'get',
    `/api/persons?operationSceneId=${fixture.eventSceneId}`,
  );
  const stored = persons.find((p) => p.id === patientId)!;
  expect(stored).toMatchObject({ triagefarbe: 'gelb', atmung: true, blutung: true });
  expect(stored.latitudePatient).toBeCloseTo(48.2082, 3);

  const body = await api<{ bodyParts: Record<string, number> }>(request, 'get', `/api/body-parts?idpatient=${patientId}`);
  expect(body.bodyParts.bauch_vorne).toBe(1);
  expect(body.bodyParts.becken_vorne).toBe(0);

  const protocol = await api<{ status: string; formState: { incident: { ambulanzort: string }; assessment_primary: { atmung: string[] }; measures: { weitere_massnahmen: { massnahmen: string[] } } } }>(
    request,
    'get',
    `/api/persons/${patientId}/ambulanzprotokoll-page1`,
  );
  expect(protocol.status).toBe('finalized');
  expect(protocol.formState.incident.ambulanzort).toBe('Pilot Wien');
  expect(protocol.formState.assessment_primary.atmung).toEqual(['Apnoe']);
  expect(protocol.formState.measures.weitere_massnahmen.massnahmen).toEqual(['Extremitaet']);

  // Back to the Lagebild: the patient is listed.
  await page.getByRole('button', { name: 'Zurück' }).click();
  await expect(page.getByRole('button', { name: `Ambulanzprotokoll für Patient ${patientId} öffnen` })).toBeVisible();
});

test('WP 1.5: PLS triage writes are audited', async ({ request }) => {
  const audit = await api<{ entries: Array<{ changedFields: string[] | null; actorRole: string }> }>(
    request,
    'get',
    `/api/audit?patientId=${patientId}&action=write&pageSize=100`,
  );
  const triageWrite = audit.entries.find((entry) => entry.changedFields?.includes('triagefarbe'));
  expect(triageWrite, 'audit row for the triage colour').toBeTruthy();
  expect(triageWrite!.actorRole).toBe('qr');
  expect(audit.entries.some((entry) => entry.changedFields?.includes('bauch_vorne'))).toBe(true);
});

test('print layout: one A4 page, paper only', async ({ page }) => {
  await loginWithQr(page);
  await chooseScene(page, 'Leitstelle');
  await page.goto(`/AmbulanzprotokollPage1/${patientId}`);
  await expect(page.locator('.ambd-page')).toBeVisible();

  const screenRatio = await page.locator('.ambd-page').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(screenRatio).toBeCloseTo(1241 / 1755, 2);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.header')).toBeHidden();
  await expect(page.locator('.sync-bar')).toBeHidden();
  await expect(page.locator('.ambd-toolbar')).toBeHidden();
  await expect(page.locator('.ambd-page')).toBeVisible();
  const printRatio = await page.locator('.ambd-page').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(printRatio).toBeCloseTo(210 / 297, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages).toHaveLength(1);
});

test('WP 1.2: old PLS local state makes no write and is removed on first start', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.url().includes('/api/')) writes.push(req.url());
  });

  await page.goto('/qrAuthenticator');
  await page.evaluate((id) => {
    localStorage.clear();
    localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'old-pls-token', adminToken: null }, version: 0 }));
    localStorage.setItem(
      'patient-location-storage',
      JSON.stringify({ state: { jobs: { [id]: { patientId: id, status: 'locating', coordinates: { lat: 1, lng: 2 }, error: null, updatedAt: '2000-01-01T00:00:00Z' } } }, version: 0 }),
    );
    localStorage.setItem(`ambdoku:page1:patient:${id}`, JSON.stringify({ patientId: id, status: 'draft', updatedAt: '2999-01-01T00:00:00Z', formState: {} }));
    localStorage.setItem('Username', 'old-admin');
  }, patientId);

  await page.goto('/');
  await expect(page).toHaveURL(/\/qrAuthenticator$/);
  await page.goto(`/AmbulanzprotokollPage1/${patientId}`);
  await expect(page).toHaveURL(/\/qrAuthenticator$/);

  const remaining = await page.evaluate(() => Object.keys(localStorage).filter((key) => key === 'auth-storage' || key === 'patient-location-storage' || key === 'Username' || key.startsWith('ambdoku:')));
  expect(remaining).toEqual([]);
  expect(writes).toEqual([]);
});
