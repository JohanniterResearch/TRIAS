import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(
  '../docs/pilot/admin-reload-debug',
  process.env.ADMIN_RELOAD_RUN ?? 'current',
);
function sql(query: string): any {
  return JSON.parse(
    execFileSync(
      'docker',
      [
        'exec',
        'trias-paket-d-acceptance',
        'psql',
        '-U',
        'pls',
        '-d',
        'paket_d_acceptance',
        '-qtA',
        '-c',
        query,
      ],
      { encoding: 'utf8' },
    ).trim(),
  );
}
function snapshot() {
  return sql(`SELECT json_build_object(
    'totalQr',(SELECT count(*) FROM qr_code_patients),
    'qr',(SELECT coalesce(json_agg(q ORDER BY id),'[]') FROM qr_code_patients q WHERE patient_id=9000),
    'receipts',(SELECT coalesce(json_agg(r ORDER BY write_id),'[]') FROM patient_write_receipts r WHERE patient_id=9000 AND scope='admin-qr'),
    'audit',(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM audit_logs a WHERE patient_id=9000 AND action='write'))`);
}
async function journal(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const opening = indexedDB.open('ambulanzsystem-patient-writes', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction('orders');
          const read = tx.objectStore('orders').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

test('admin QR: lost committed response, fully offline reload, reconnect and resume journal', async ({
  page,
  context,
}) => {
  mkdirSync(directory, { recursive: true });
  const evidence: any = { stages: [], requests: [], failures: [], console: [] };
  function record(stage: string) {
    evidence.stages.push({ stage, time: new Date().toISOString() });
    writeFileSync(resolve(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(stage);
  }
  page.on('pageerror', (e) => {
    evidence.console.push(String(e));
    record('pageerror');
  });
  page.on('requestfailed', (r) => evidence.failures.push({ url: r.url(), failure: r.failure() }));
  await page.goto('/admin/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByLabel('Benutzername', { exact: true }).fill('admin');
  await page.getByLabel('Passwort', { exact: true }).fill('dev-admin-password');
  await page.getByRole('button', { name: 'Einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByLabel('Patientenkennung oder Name').fill('D-BESTAND');
  await page
    .locator('form')
    .filter({ has: page.getByLabel('Patientenkennung oder Name') })
    .getByRole('button', { name: 'Suchen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Details / korrigieren', exact: true }).click();
  await page
    .getByRole('button', { name: 'Weitere Patientendaten bearbeiten', exact: true })
    .click();
  evidence.before = snapshot();
  record('patient-open');
  let resume = false;
  let committed = false;
  await page.route('**/api/admin/patients/*/assign-qr-code', async (route) => {
    evidence.requests.push({
      url: route.request().url(),
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    if (committed && !resume) return route.abort('failed');
    if (!committed) {
      evidence.beforeFirstSend = await journal(page);
      expect(evidence.beforeFirstSend).toHaveLength(1);
      expect(evidence.beforeFirstSend[0].writeId).toBe(evidence.requests[0].key);
      expect(evidence.beforeFirstSend[0].body).toEqual(evidence.requests[0].body);
      record('journal-durable-before-api');
    }
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.status()).toBe(200);
    if (!committed) {
      evidence.firstResponse = await response.json();
      evidence.committed = snapshot();
      expect(evidence.committed.totalQr).toBe(evidence.before.totalQr + 1);
      expect(evidence.committed.audit).toHaveLength(evidence.before.audit.length + 1);
      expect(evidence.committed.receipts).toHaveLength(evidence.before.receipts.length + 1);
      committed = true;
      record('api-committed-before-response-loss');
      await context.setOffline(true);
      await route.abort('failed');
    } else {
      expect(await response.json()).toEqual(evidence.firstResponse);
      await route.fulfill({ response });
      record('real-api-replay-response-delivered');
    }
  });
  await page.getByRole('button', { name: 'Neuen QR erzeugen und zuweisen', exact: true }).click();
  record('assignment-click-completed');
  await expect.poll(() => committed).toBe(true);
  await expect.poll(() => evidence.requests.length).toBeGreaterThanOrEqual(2);
  evidence.beforeReload = await journal(page);
  expect(evidence.beforeReload).toEqual(evidence.beforeFirstSend);
  record('before-offline-reload');
  await page.reload({ timeout: 10_000 });
  record('offline-reload-load-completed');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { name: 'Anmelden', exact: true })).toBeVisible();
  evidence.afterReload = await journal(page);
  expect(evidence.afterReload).toEqual(evidence.beforeReload);
  record('journal-survives-offline-reload');
  resume = true;
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await journal(page)).length, { timeout: 15_000 }).toBe(0);
  evidence.after = snapshot();
  expect(evidence.after).toEqual(evidence.committed);
  expect(evidence.requests.length).toBeGreaterThanOrEqual(3);
  for (const request of evidence.requests) expect(request).toEqual(evidence.requests[0]);
  record('journal-complete-database-unchanged');
  await context.setOffline(false);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  record('admin-access-revalidated-online');
});
