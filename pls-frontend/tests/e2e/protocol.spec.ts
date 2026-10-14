import { expect, test, type APIRequestContext } from '@playwright/test';
import { decodePage1, encodePage1 } from '../../src/features/ambulanzprotokoll-page1/ambulanzValueMap';
import { normalizePage1State, type Page1State } from '../../src/features/ambulanzprotokoll-page1/page1State';
import { protocolVariant, VARIANT_COUNT } from '../../src/test/protocolVariants';

// Parity plan Phase 4 exit criteria against the real backend:
// - every PLS-produced payload validates against the Ambulanzsystem schema (the server validates
//   strictly: enums, patterns, no extra properties) and survives the round trip unchanged;
// - a correction of a finalized protocol needs a reason and is recorded (revision rows are
//   checked in the backend suite: ProtocolCorrectionRevisionTests);
// - the export is the server's watermarked document, decoded to PLS values.

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.PLS_E2E_BACKEND_PORT ?? '5043'}`;
let adminToken: string;
let eventSceneId: number;

async function call<T>(request: APIRequestContext, method: 'get' | 'post' | 'put', path: string, data?: unknown) {
  const response = await request[method](`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${adminToken}` }, data });
  expect(response.ok(), `${method} ${path} -> ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

const newPatient = async (request: APIRequestContext) =>
  (await call<{ id: number }>(request, 'post', '/api/persons/manual', { operationSceneId: eventSceneId, clientGeneratedId: crypto.randomUUID() })).id;

test.beforeAll(async ({ request }) => {
  adminToken = (await (await request.post(`${apiUrl}/api/dev-login`, { data: { role: 'admin' } })).json()).token;
  const scenes = await call<Array<{ id: number; name: string; parentSceneId: number | null }>>(request, 'get', '/api/operation-scenes');
  eventSceneId = scenes.find((scene) => scene.name === 'Demo-Event Wien' && scene.parentSceneId == null)!.id;
});

test(`every PLS payload is accepted by the server and round-trips losslessly (${VARIANT_COUNT} variants, 79 leaves)`, async ({ request }) => {
  for (let index = 0; index < VARIANT_COUNT; index++) {
    const state = protocolVariant(index);
    const patientId = await newPatient(request);
    const path = `/api/persons/${patientId}/ambulanzprotokoll-page1`;
    await call(request, 'put', path, { status: 'draft', formState: encodePage1(state), clientUpdatedAt: new Date(Date.now() - 60_000).toISOString() });
    const stored = await call<{ formState: Page1State }>(request, 'get', path);
    expect(normalizePage1State(decodePage1(stored.formState)), `variant ${index}`).toEqual(state);
  }
});

test('finalized protocol is read-only; a correction needs a reason and is audited with it', async ({ page, request }) => {
  const patientId = await newPatient(request);
  const path = `/api/persons/${patientId}/ambulanzprotokoll-page1`;
  await call(request, 'put', path, { status: 'finalized', formState: { incident: { ambulanzort: 'Erstfassung' } } });

  // Staff session in the browser (dev login), opened on the protocol.
  await page.goto('/AdminLandingPage');
  await page.getByRole('button', { name: 'DEV: Skip to Admin Settings' }).click();
  await expect(page).toHaveURL(/\/AdminSettingsPage$/);
  await page.evaluate((scene) => {
    localStorage.setItem('pls:ambulanz-v1:work-context', JSON.stringify({ state: { operationSceneId: scene, patientId: null, patientLabel: null }, version: 0 }));
  }, eventSceneId);
  await page.goto(`/AmbulanzprotokollPage1/${patientId}`);
  await expect(page.getByText('Status: finalized')).toBeVisible();
  const place = page.getByLabel('Ambulanzort');
  await expect(place).toHaveValue('Erstfassung');
  await expect(place).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finalisieren' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Korrektur' }).click();
  await expect(page.getByRole('button', { name: 'Korrektur beginnen' })).toBeDisabled();
  await page.getByLabel('Grund der Korrektur (Pflicht, höchstens 500 Zeichen)').fill('Ort falsch erfasst');
  await page.getByRole('button', { name: 'Korrektur beginnen' }).click();
  await expect(place).toBeEnabled();
  await place.fill('Korrigiert');
  await page.getByRole('button', { name: 'Korrektur speichern' }).click();
  await expect(page.getByRole('region', { name: 'Korrektur' })).toHaveCount(0);
  await expect(place).toBeDisabled();

  const stored = await call<{ status: string; formState: Page1State }>(request, 'get', path);
  expect(stored.status).toBe('finalized');
  expect(stored.formState.incident.ambulanzort).toBe('Korrigiert');
  const audit = await call<{ entries: Array<{ action: string; changedFields: string[] | null; reason?: string | null }> }>(
    request,
    'get',
    `/api/audit?patientId=${patientId}&action=write&pageSize=100`,
  );
  expect(audit.entries.some((entry) => entry.changedFields?.includes('incident.ambulanzort') && entry.reason === 'Ort falsch erfasst')).toBe(true);
});

test('export: the server document, watermarked and decoded to PLS values', async ({ page, request }) => {
  const patientId = await newPatient(request);
  const state = protocolVariant(1);
  await call(request, 'put', `/api/persons/${patientId}/ambulanzprotokoll-page1`, { status: 'draft', formState: encodePage1(state) });

  await page.goto('/AdminLandingPage');
  await page.getByRole('button', { name: 'DEV: Skip to Admin Settings' }).click();
  await expect(page).toHaveURL(/\/AdminSettingsPage$/);
  await page.goto(`/AmbulanzprotokollPage1/${patientId}`);
  await expect(page.locator('.ambd-page')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const exported = JSON.parse(await readFile(file, 'utf-8')) as { metadata: { watermark: string; patientId: number }; protokoll: { formState: Page1State } };

  expect(exported.metadata.patientId).toBe(patientId);
  expect(exported.metadata.watermark).toBeTruthy();
  expect(normalizePage1State(exported.protokoll.formState)).toEqual(state);
  const audit = await call<{ entries: Array<{ action: string }> }>(request, 'get', `/api/audit?patientId=${patientId}&action=export&pageSize=10`);
  expect(audit.entries.length).toBeGreaterThan(0);
});
