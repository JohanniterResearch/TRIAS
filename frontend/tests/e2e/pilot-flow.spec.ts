import { expect, Page, test } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

test.describe.configure({ mode: 'serial' });

const apiUrl = `http://127.0.0.1:${process.env.BACKEND_PORT ?? '5042'}`;

let loginPartition = 10;

async function isolateLoginRateLimit(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    'X-Forwarded-For': `127.0.0.${loginPartition++}`,
  });
}

test('persisted forced-password sessions cannot enter protected routes', async ({ page }) => {
  await isolateLoginRateLimit(page);
  await page.goto('/admin/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill('dev-admin-password');
  await page.getByRole('button', { name: 'Einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/change-password$/);
});

test('Leitstelle completes forced password change and lands on the team view', async ({ page }) => {
  const adminToken = await loginDevAdmin(page);
  const username = `e2e-leitstelle-${Date.now()}`;
  const initialPassword = 'Leitstelle123!';
  const replacementPassword = 'Leitstelle456!';
  const create = await page.request.post(`${apiUrl}/api/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { username, password: initialPassword, role: 'leitstelle' },
  });
  expect(create.status()).toBe(201);

  await page.evaluate(() => localStorage.clear());
  await isolateLoginRateLimit(page);
  await page.goto('/admin/login');
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(initialPassword);
  await page.getByRole('button', { name: 'Einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel('Aktuelles Passwort').fill(initialPassword);
  await page.getByLabel('Neues Passwort').fill(replacementPassword);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(replacementPassword);
  await page.getByRole('button', { name: 'Einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/teams$/);
});

test('temporary validation outage preserves the local workspace', async ({ page }) => {
  await page.goto('/login');
  await page.evaluate(() =>
    localStorage.setItem(
      'ambulanzsystem.auth.v1',
      JSON.stringify({
        admin: null,
        responder: {
          token: 'temporarily-unverifiable',
          tokenType: 'user',
          username: 'offline-responder',
          savedAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await page.evaluate(() =>
    localStorage.setItem(
      'ambulanzsystem.triage-drafts.v1',
      JSON.stringify({ 1: { notes: 'retain' } }),
    ),
  );
  await page.route('**/api/validate-token', (route) => route.abort('connectionfailed'));
  await page.goto('/scan-patient');
  await expect(page).toHaveURL(/\/scan-patient$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ambulanzsystem.triage-drafts.v1')))
    .toContain('retain');
});

async function loginResponder(page: Page): Promise<void> {
  await isolateLoginRateLimit(page);
  await page.goto('/login');
  await page.getByRole('button', { name: 'DEV Responder' }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
}

async function loginRealResponder(page: Page, username: string, password: string): Promise<void> {
  await isolateLoginRateLimit(page);
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: 'Mit Passwort einloggen' }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
}

async function loginDevAdmin(page: Page): Promise<string> {
  await isolateLoginRateLimit(page);
  await page.goto('/admin/login');
  await page.getByRole('button', { name: 'DEV Admin' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return await activeToken(page);
}

async function openSituationRoomAsDevAdmin(page: Page, sceneId: number): Promise<void> {
  await loginDevAdmin(page);
  await page.goto('/situation-room');
  await page.getByLabel('Szene ID').fill(String(sceneId));
  await page.getByRole('button', { name: 'Öffnen' }).click();
  await expect(page.getByText('live', { exact: true })).toBeVisible();
}

async function activeToken(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('ambulanzsystem.auth.v1') ?? '{}');
    return state.responder?.token ?? state.admin?.token ?? '';
  });
}

async function selectFirstScene(page: Page): Promise<number> {
  const scene = page.locator('.choice-grid button').first();
  await expect(scene).toBeVisible();
  const text = await scene.innerText();
  const sceneId = Number(text.match(/ID (\d+)/)?.[1]);
  expect(sceneId).toBeGreaterThan(0);
  await scene.click();
  await expect(page).toHaveURL(/\/scan-patient$/);
  return sceneId;
}

async function createManualPatient(page: Page): Promise<{ id: string; label: string }> {
  await page.getByRole('button', { name: 'Manuellen Patienten anlegen' }).click();
  await expect(page).toHaveURL(/\/patient\/-?\d+$/);
  return {
    id: page.url().split('/').at(-1)!,
    label: (await page.getByRole('heading', { level: 1 }).innerText()).trim(),
  };
}

test('responder completes triage and protocol against the real backend', async ({ page }) => {
  await loginResponder(page);
  await selectFirstScene(page);
  await createManualPatient(page);

  await page.getByRole('link', { name: 'Triage', exact: true }).click();
  expect(
    (await page.getByRole('button', { name: 'Rot', exact: true }).boundingBox())?.height,
  ).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Rot', exact: true }).click();
  await expect(page.getByText('Gespeichert.')).toBeVisible();

  await page.getByRole('link', { name: 'Körper vorne markieren' }).click();
  const region = page.locator('.body-region-map button').first();
  expect((await region.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(region).toHaveAttribute('aria-pressed', 'false');
  await region.click();
  await expect(region).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('link', { name: 'Zurück zur Triage' }).click();

  await page.getByRole('link', { name: 'Ambulanzprotokoll' }).click();
  await expect(page.locator('.protocol-page')).toBeVisible();
  expect(
    await page
      .locator(
        '.protocol-page input, .protocol-page textarea, .protocol-page select, .protocol-page button',
      )
      .count(),
  ).toBeGreaterThan(100);
  await page.getByLabel('Ambulanzort').fill('Pilot Wien');
  await page.getByLabel('Datum', { exact: true }).fill('2026-07-13');
  await page.getByLabel('Patient - Familienname').fill('Pilot');
  await page.getByRole('button', { name: 'Finalisieren' }).click();
  await expect(page.getByText('Finalisiert', { exact: true })).toBeVisible();
  await expect(page.getByText(/^server /)).toBeVisible();

  await page.setViewportSize({ width: 800, height: 1280 });
  const ratio = await page.locator('.protocol-page').evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(ratio).toBeCloseTo(1241 / 1755, 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.protocol-toolbar')).toBeHidden();
  await expect(page.locator('.protocol-page')).toBeVisible();
});

test('offline manual intake and triage replay after reconnect', async ({ context, page }) => {
  await loginResponder(page);
  await selectFirstScene(page);
  await context.setOffline(true);
  const provisionalPatient = await createManualPatient(page);
  expect(Number(provisionalPatient.id)).toBeLessThan(0);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.getByRole('link', { name: 'Triage', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gelb', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Gelb', exact: true }).click();
  await expect(page.getByText('Lokal gespeichert, Sync ausstehend.')).toBeVisible();
  await expect(page.getByText(/offen/)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/offen/)).toHaveCount(0, { timeout: 15_000 });
});

test('situation room receives a triage update from another browser', async ({ browser }) => {
  const responder = await browser.newContext();
  const responderPage = await responder.newPage();
  await loginResponder(responderPage);
  const sceneId = await selectFirstScene(responderPage);
  const patient = await createManualPatient(responderPage);

  const command = await browser.newContext();
  const commandPage = await command.newPage();
  await openSituationRoomAsDevAdmin(commandPage, sceneId);
  const row = commandPage.locator('tbody tr').filter({ hasText: patient.label });
  await expect(row).toBeVisible();

  await responderPage.getByRole('link', { name: 'Triage', exact: true }).click();
  await responderPage.getByRole('button', { name: 'Schwarz', exact: true }).click();
  await expect(row).toContainText('schwarz', { timeout: 15_000 });

  await responder.close();
  await command.close();
});

test('situation room refetches the full scene snapshot after reconnect', async ({ browser }) => {
  const command = await browser.newContext();
  const commandPage = await command.newPage();
  await openSituationRoomAsDevAdmin(commandPage, 1);
  await command.setOffline(true);

  const responder = await browser.newContext();
  const responderPage = await responder.newPage();
  await loginResponder(responderPage);
  await selectFirstScene(responderPage);
  const patient = await createManualPatient(responderPage);
  await expect
    .poll(() =>
      responderPage.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}');
        return state.patient?.id ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  await command.setOffline(false);
  await expect(commandPage.locator('tbody tr').filter({ hasText: patient.label })).toBeVisible({
    timeout: 20_000,
  });

  await responder.close();
  await command.close();
});

test('real responder refresh and self-cancel revoke the live session', async ({
  browser,
  page,
}) => {
  const username = `self-cancel-${Date.now()}`;
  const password = 'SelfCancel123!';
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  const adminToken = await loginDevAdmin(adminPage);
  const create = await adminPage.request.post(`${apiUrl}/api/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { username, password, role: 'responder' },
  });
  expect(create.status()).toBe(201);
  await admin.close();

  await loginRealResponder(page, username, password);
  const session = await page.evaluate(
    () => JSON.parse(localStorage.getItem('ambulanzsystem.auth.v1')!).responder,
  );
  const refresh = await page.request.post(`${apiUrl}/api/refresh-token`, {
    data: { refreshToken: session.refreshToken },
  });
  expect(refresh.ok()).toBeTruthy();

  await page.getByRole('button', { name: 'Zugang beenden' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const validation = await page.request.post(`${apiUrl}/api/validate-token`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  expect(validation.status()).toBe(401);
});

test('generated responder QR logs in and patient QR scanning stays idempotent', async ({
  browser,
}) => {
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  const adminToken = await loginDevAdmin(adminPage);
  const loginQrResponse = await adminPage.request.post(`${apiUrl}/api/login-qr-codes/generate`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { eventSceneId: 1, number: 1, expiresInHours: 12 },
  });
  expect(loginQrResponse.ok()).toBeTruthy();
  const [loginQr] = await loginQrResponse.json();
  const patientQrResponse = await adminPage.request.post(
    `${apiUrl}/api/patient-qr-codes/generate`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { number: 2 },
    },
  );
  expect(patientQrResponse.ok()).toBeTruthy();
  const [patientQr, replacementQr] = await patientQrResponse.json();

  const responder = await browser.newContext();
  const page = await responder.newPage();
  await isolateLoginRateLimit(page);
  await page.goto('/login');
  await page.getByLabel('QR Code', { exact: true }).fill(loginQr.qrToken);
  await page.getByRole('button', { name: 'Einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
  const qrSessionToken = await activeToken(page);
  await selectFirstScene(page);
  await page.getByLabel('Patient QR Code').fill(patientQr);
  await page.getByRole('button', { name: 'QR prüfen' }).click();
  await expect(page).toHaveURL(/\/patient\/\d+$/);
  const firstId = page.url().split('/').at(-1);

  await page.goto('/scan-patient');
  await page.getByLabel('Patient QR Code').fill(patientQr);
  await page.getByRole('button', { name: 'QR prüfen' }).click();
  await expect(page).toHaveURL(new RegExp(`/patient/${firstId}$`));
  await page.getByLabel('Neuer QR Code').fill(replacementQr);
  await page.getByRole('button', { name: 'QR ersetzen' }).click();
  await expect(page.getByText('QR Code wurde ersetzt.')).toBeVisible();
  const revokeQr = await adminPage.request.post(
    `${apiUrl}/api/login-qr-codes/${loginQr.id}/revoke`,
    {
      headers: { Authorization: `Bearer ${adminToken}` },
    },
  );
  expect(revokeQr.status()).toBe(204);
  const revokedQrValidation = await page.request.post(`${apiUrl}/api/validate-token`, {
    headers: { Authorization: `Bearer ${qrSessionToken}` },
  });
  expect(revokedQrValidation.status()).toBe(401);

  await responder.close();
  await admin.close();
});

test('Admin completes the forced password change', async ({ browser }) => {
  const changedPassword = 'PilotChanged123!';

  const forced = await browser.newContext();
  const forcedPage = await forced.newPage();
  await isolateLoginRateLimit(forcedPage);
  await forcedPage.goto('/admin/login');
  await forcedPage.getByLabel('Benutzername').fill('admin');
  await forcedPage.getByLabel('Passwort').fill('dev-admin-password');
  await forcedPage.getByRole('button', { name: 'Einloggen' }).click();
  await expect(forcedPage).toHaveURL(/\/change-password$/);
  await forcedPage.getByLabel('Aktuelles Passwort').fill('dev-admin-password');
  await forcedPage.getByLabel('Neues Passwort').fill(changedPassword);
  await forcedPage.getByRole('button', { name: 'Passwort ändern' }).click();
  await expect(forcedPage).toHaveURL(/\/admin\/login$/);
  await forcedPage.getByLabel('Benutzername').fill('admin');
  await forcedPage.getByLabel('Passwort').fill(changedPassword);
  await forcedPage.getByRole('button', { name: 'Einloggen' }).click();
  await expect(forcedPage).toHaveURL(/\/admin$/);
  await forcedPage.goto('/situation-room');
  await forcedPage.getByLabel('Szene ID').fill('1');
  await forcedPage.getByRole('button', { name: 'Öffnen' }).click();
  const rows = forcedPage.locator('tbody tr');
  await expect(rows.first()).toBeVisible();

  await rows.first().click();
  await expect(forcedPage).toHaveURL(/\/ambulanzprotokoll\/\d+$/);
  await forcedPage.getByRole('button', { name: 'Zurück' }).click();
  await expect(forcedPage).toHaveURL(/\/situation-room$/);

  await expect(rows.first()).toBeVisible();
  await rows.first().press('Enter');
  await expect(forcedPage).toHaveURL(/\/ambulanzprotokoll\/\d+$/);
  await forcedPage.getByRole('button', { name: 'Zurück' }).click();
  await expect(forcedPage.locator('.leaflet-interactive').first()).toBeVisible();
  await forcedPage.locator('.leaflet-interactive').first().dispatchEvent('click');
  await expect(forcedPage).toHaveURL(/\/ambulanzprotokoll\/\d+$/);
  await forced.close();
});

test('offline provisional identity and drafts survive reload and bind to the real patient', async ({
  context,
  page,
}) => {
  await loginResponder(page);
  await selectFirstScene(page);
  const sourcePatient = await createManualPatient(page);
  await page.getByRole('link', { name: 'Beides starten' }).click();
  await page.getByRole('button', { name: 'Weiter zum Ambulanzprotokoll' }).click();
  await page.getByLabel('Ambulanzort').fill('Draft source');
  await page.waitForTimeout(900);
  await page.getByRole('link', { name: 'Ambulanzsystem' }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
  await selectFirstScene(page);
  await context.setOffline(true);
  const provisional = await createManualPatient(page);
  await page.evaluate(
    async ({ sourceId, provisionalId }) => {
      localStorage.setItem(
        'ambulanzsystem.triage-drafts.v1',
        JSON.stringify({
          [provisionalId]: { triageColor: 'gelb', clientUpdatedAt: new Date().toISOString() },
        }),
      );
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ambulanzsystem-protokoll', 1);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction('page1-drafts', 'readwrite');
          const store = transaction.objectStore('page1-drafts');
          const get = store.get(Number(sourceId));
          get.onsuccess = () => {
            const draft = get.result;
            draft.patientId = Number(provisionalId);
            draft.formState.incident.ambulanzort = 'Offline Pilot';
            draft.updatedAt = new Date().toISOString();
            store.put(draft);
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        open.onerror = () => reject(open.error);
      });
    },
    { sourceId: sourcePatient.id, provisionalId: provisional.id },
  );

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const state = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}');
          return state.patient?.id ?? 0;
        }),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        await page.evaluate((id) => {
          const drafts = JSON.parse(
            localStorage.getItem('ambulanzsystem.triage-drafts.v1') ?? '{}',
          );
          return drafts[id] === undefined;
        }, provisional.id),
    )
    .toBeTruthy();

  const restarted = await context.newPage();
  await restarted.goto('/triage');
  await expect(restarted.getByRole('heading', { name: 'Triage erfassen' })).toBeVisible();
  await restarted.getByRole('link', { name: 'Ambulanzprotokoll' }).click();
  await expect(restarted).toHaveURL(/\/ambulanzprotokoll\/\d+$/);
  await expect(restarted.getByLabel('Ambulanzort')).toHaveValue('Offline Pilot');
});

test('legacy numeric patient mappings rekey active state and drafts on startup', async ({
  page,
}) => {
  await loginResponder(page);
  await selectFirstScene(page);
  await createManualPatient(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}');
        return state.patient?.id ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  const patientId = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}');
    return Number(state.patient.id);
  });
  await page.goto(`/ambulanzprotokoll/${patientId}`);
  await expect(page.getByLabel('Ambulanzort')).toBeVisible();
  await page.getByLabel('Ambulanzort').fill('Legacy source');
  await page.waitForTimeout(900);

  const provisionalId = -987654321;
  await page.evaluate(
    async ({ realId, provisionalId }) => {
      const responder = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1')!);
      responder.patient = { ...responder.patient, id: provisionalId };
      localStorage.setItem('ambulanzsystem.responder.v1', JSON.stringify(responder));
      localStorage.setItem(
        'ambulanzsystem.triage-drafts.v1',
        JSON.stringify({
          [provisionalId]: { triageColor: 'rot', clientUpdatedAt: new Date().toISOString() },
        }),
      );

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('ambulanzsystem-offline', 1);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('patient-map', 'readwrite');
            transaction.objectStore('patient-map').put(realId, provisionalId);
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
          open.onerror = () => reject(open.error);
        }),
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('ambulanzsystem-protokoll', 1);
          open.onsuccess = () => {
            const db = open.result;
            const transaction = db.transaction('page1-drafts', 'readwrite');
            const store = transaction.objectStore('page1-drafts');
            const get = store.get(realId);
            get.onsuccess = () => {
              store.put({
                ...get.result,
                patientId: provisionalId,
                updatedAt: new Date(Date.now() + 1_000).toISOString(),
                formState: {
                  ...get.result.formState,
                  incident: { ...get.result.formState.incident, ambulanzort: 'Legacy rebound' },
                },
              });
            };
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onerror = () => reject(transaction.error);
          };
          open.onerror = () => reject(open.error);
        }),
      ]);
    },
    { realId: patientId, provisionalId },
  );

  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}');
        return state.patient?.id;
      }),
    )
    .toBe(patientId);
  await expect
    .poll(() =>
      page.evaluate(
        ({ realId, provisionalId }) => {
          const drafts = JSON.parse(
            localStorage.getItem('ambulanzsystem.triage-drafts.v1') ?? '{}',
          );
          return drafts[realId]?.triageColor === 'rot' && drafts[provisionalId] === undefined;
        },
        { realId: patientId, provisionalId },
      ),
    )
    .toBeTruthy();
  await expect(page.getByLabel('Ambulanzort')).toHaveValue('Legacy rebound');
  await expect
    .poll(() =>
      page.evaluate(
        ({ realId, provisionalId }) =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open('ambulanzsystem-offline', 1);
            open.onsuccess = () => {
              const db = open.result;
              const request = db
                .transaction('patient-map', 'readonly')
                .objectStore('patient-map')
                .get(provisionalId);
              request.onsuccess = () => {
                resolve(request.result.realId === realId);
                db.close();
              };
              request.onerror = () => reject(request.error);
            };
            open.onerror = () => reject(open.error);
          }),
        { realId: patientId, provisionalId },
      ),
    )
    .toBeTruthy();
});
