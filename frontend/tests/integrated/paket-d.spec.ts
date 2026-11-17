import { expect, Page, BrowserContext, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test.describe.configure({ mode: 'default' });
const container = 'trias-paket-d-acceptance';
let partition = 100;
function sql(query: string): any {
  const output = execFileSync(
    'docker',
    ['exec', container, 'psql', '-U', 'pls', '-d', 'paket_d_acceptance', '-qtA', '-c', query],
    { encoding: 'utf8' },
  ).trim();
  return output ? JSON.parse(output) : null;
}
function snapshot(id: number) {
  return sql(`SELECT json_build_object(
 'patient',(SELECT row_to_json(p) FROM patients p WHERE id=${id}),
 'qr',(SELECT coalesce(json_agg(q ORDER BY id),'[]') FROM qr_code_patients q WHERE patient_id=${id}),
 'protocol',(SELECT row_to_json(p) FROM ambulanzprotokoll_page1s p WHERE patient_id=${id}),
 'revisions',(SELECT coalesce(json_agg(r ORDER BY version),'[]') FROM ambulanzprotokoll_revisions r WHERE patient_id=${id}),
 'audit',(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM audit_logs a WHERE patient_id=${id} AND action='write'),
 'protocolKeys',(SELECT coalesce(json_agg(w ORDER BY write_id),'[]') FROM protokoll_processed_writes w WHERE patient_id=${id}),
 'receipts',(SELECT coalesce(json_agg(w ORDER BY write_id),'[]') FROM patient_write_receipts w WHERE patient_id=${id}),
 'body',(SELECT row_to_json(b) FROM bodies b WHERE patient_id=${id}))`);
}
async function evidence(name: string, data: unknown) {
  await test
    .info()
    .attach(name, { body: JSON.stringify(data, null, 2), contentType: 'application/json' });
}
async function items(page: Page, journal = false): Promise<any[]> {
  return page.evaluate(
    ({ journal }) =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open(
          journal ? 'ambulanzsystem-patient-writes' : 'ambulanzsystem-offline',
          1,
        );
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = journal ? 'orders' : 'queue';
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(store);
          const read = tx.objectStore(store).getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { journal },
  );
}
async function login(page: Page, admin = false) {
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `127.0.1.${partition++}` });
  await page.goto(admin ? '/admin/login' : '/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByLabel('Benutzername', { exact: true }).fill(admin ? 'admin' : 'responder-demo');
  await page
    .getByLabel('Passwort', { exact: true })
    .fill(admin ? 'dev-admin-password' : 'responder-demo');
  await page
    .getByRole('button', { name: admin ? 'Einloggen' : 'Mit Passwort einloggen', exact: true })
    .click();
  await expect(page).toHaveURL(admin ? /\/admin$/ : /\/role-selection$/);
  if (!admin) {
    await page.locator('.choice-grid button').filter({ hasText: 'Paket D upgrade' }).click();
    await expect(page).toHaveURL(/\/scan-patient$/);
  }
}
async function patientId(page: Page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1') ?? '{}').patient?.id ?? 0,
  );
}
async function create(page: Page, name: string) {
  await page.getByLabel('Name optional').fill(name);
  await page.getByRole('button', { name: 'Manuellen Patienten anlegen', exact: true }).click();
  await expect.poll(() => patientId(page)).toBeGreaterThan(0);
  return patientId(page);
}
async function token(page: Page) {
  return page.evaluate(() => {
    const a = JSON.parse(localStorage.getItem('ambulanzsystem.auth.v1')!);
    return a.responder?.token ?? a.admin?.token;
  });
}
async function reconnect(page: Page, context: BrowserContext) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(
      async () => {
        const q = await items(page);
        if (q.some((x) => x.nextAttemptAt && Date.parse(x.nextAttemptAt) > Date.now()))
          return false;
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        return q.length === 0;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

test('manual intake: committed response lost, reload replays durable creation exactly once', async ({
  page,
  context,
}) => {
  await login(page);
  const requests: any[] = [];
  let committed: any;
  await page.route('**/api/persons/manual', async (route) => {
    const body = route.request().postDataJSON();
    requests.push({
      key: body.clientGeneratedId,
      header: route.request().headers()['idempotency-key'],
      body,
    });
    const attempt = requests.length;
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    if (attempt === 1) {
      const patient = await response.json();
      committed = snapshot(patient.id);
      await context.setOffline(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByLabel('Name optional').fill('D lost manual');
  await page.getByRole('button', { name: 'Manuellen Patienten anlegen', exact: true }).click();
  await expect.poll(() => Boolean(committed)).toBe(true);
  await expect
    .poll(async () => (await items(page)).some((x) => x.type === 'manual-patient'))
    .toBe(true);
  const queued = await items(page);
  await page.reload();
  expect(await items(page)).toEqual(queued);
  await reconnect(page, context);
  expect(requests.length).toBeGreaterThan(1);
  requests.forEach((r) => expect(r).toEqual(requests[0]));
  const id = committed.patient.id;
  expect(snapshot(id)).toEqual(committed);
  expect(
    sql(`SELECT count(*)::int FROM patients WHERE client_generated_id='${requests[0].key}'`),
  ).toBe(1);
  expect(committed.receipts.filter((x: any) => x.scope === 'manual')).toHaveLength(1);
  await evidence('manual-requests-and-state', { requests, queued, committed, after: snapshot(id) });
});

test('protocol finalization: response lost after commit, offline reload replays same order', async ({
  page,
  context,
}) => {
  await login(page);
  const id = await create(page, 'D lost finalize');
  await page.goto(`/ambulanzprotokoll/${id}`);
  await expect(page.locator('.protocol-page')).toBeVisible();
  const requests: any[] = [];
  let committed: any;
  await page.route(`**/api/persons/${id}/ambulanzprotokoll-page1`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    if (requests.length === 1) {
      committed = snapshot(id);
      await context.setOffline(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Finalisieren', exact: true }).click();
  await expect.poll(() => Boolean(committed)).toBe(true);
  await expect.poll(async () => (await items(page)).some((x) => x.type === 'protocol')).toBe(true);
  await page.reload();
  await reconnect(page, context);
  expect(requests.length).toBeGreaterThan(1);
  requests.forEach((r) => expect(r).toEqual(requests[0]));
  expect(snapshot(id)).toEqual(committed);
  expect(committed.revisions).toHaveLength(1);
  expect(committed.audit.filter((a: any) => a.entity_type === 'ambulanzprotokoll')).toHaveLength(1);
  await expect(page.getByText('Finalisiert', { exact: true })).toBeVisible();
  await evidence('protocol-requests-and-state', { requests, committed, after: snapshot(id) });
});

test('admin QR assignment: real product action, lost committed answer, journal replay after reload', async ({
  page,
  context,
  browser,
}) => {
  const name = `D lost admin QR ${Date.now()}`;
  const setup = await browser.newContext();
  const responder = await setup.newPage();
  await login(responder);
  const id = await create(responder, name);
  await setup.close();
  await login(page, true);
  const beforeTotal = sql('SELECT count(*)::int FROM qr_code_patients');
  await page.getByLabel('Patientenkennung oder Name').fill(name);
  await page
    .locator('form')
    .filter({ has: page.getByLabel('Patientenkennung oder Name') })
    .getByRole('button', { name: 'Suchen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Details / korrigieren', exact: true }).click();
  await page
    .getByRole('button', { name: 'Weitere Patientendaten bearbeiten', exact: true })
    .click();
  const requests: any[] = [];
  let committed: any;
  let firstResult: any;
  let resumed = false;
  await page.route('**/api/admin/patients/*/assign-qr-code', async (route) => {
    requests.push({
      url: route.request().url(),
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    const attempt = requests.length;
    if (attempt > 1 && !resumed) return route.abort('failed');
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    if (attempt === 1) {
      firstResult = await response.json();
      committed = snapshot(id);
      await context.setOffline(true);
      await route.abort('failed');
    } else {
      expect(await response.json()).toEqual(firstResult);
      await route.fulfill({ response });
    }
  });
  await page.getByRole('button', { name: 'Neuen QR erzeugen und zuweisen', exact: true }).click();
  await expect.poll(() => Boolean(committed)).toBe(true);
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await items(page, true)).length).toBe(1);
  // Admin routes require online validation; reconnect before reloading. Keep losing transport
  // answers until the new page is loaded, proving recovery from the persisted journal.
  await context.setOffline(false);
  await page.reload();
  resumed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await items(page, true)).length, { timeout: 20_000 }).toBe(0);
  expect(requests.length).toBeGreaterThan(2);
  requests.forEach((r) => expect(r).toEqual(requests[0]));
  expect(snapshot(id)).toEqual(committed);
  expect(sql('SELECT count(*)::int FROM qr_code_patients')).toBe(beforeTotal + 1);
  expect(committed.qr).toHaveLength(1);
  expect(committed.audit.filter((a: any) => a.changed_fields?.includes('qr_code'))).toHaveLength(1);
  await evidence('admin-qr-requests-and-state', {
    requests,
    committed,
    firstResult,
    after: snapshot(id),
  });
});

test('upgraded historical protocol checksum: exact retry accepted, changed request is 409', async ({
  page,
}) => {
  await login(page, true);
  const fixture = JSON.parse(
    readFileSync('../docs/pilot/acceptance-harness/upgrade-result.json', 'utf8'),
  );
  const original = snapshot(9000);
  const headers = {
    Authorization: `Bearer ${await token(page)}`,
    'Idempotency-Key': fixture.writeId,
  };
  const response = await page.request.put('/api/persons/9000/ambulanzprotokoll-page1', {
    headers,
    data: fixture.order,
  });
  expect(response.status()).toBe(200);
  expect(snapshot(9000)).toEqual(original);
  const changed = structuredClone(fixture.order);
  changed.formState.patient.vorname = 'Changed';
  const conflict = await page.request.put('/api/persons/9000/ambulanzprotokoll-page1', {
    headers,
    data: changed,
  });
  expect(conflict.status()).toBe(409);
  expect(snapshot(9000)).toEqual(original);
  expect(original.body.region_timestamps_json).toEqual({});
  await evidence('historical-checksum', {
    fixture,
    original,
    replayStatus: response.status(),
    changedStatus: conflict.status(),
    after: snapshot(9000),
  });
});

async function twoClients(browser: any) {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await login(pa);
  const id = await create(pa, `D two clients ${Date.now()}`);
  sql(
    `INSERT INTO qr_code_patients(qr_token,patient_id,operation_scene_id,created_at,updated_at) VALUES ('D-client-${id}',${id},9000,now(),now()) RETURNING id`,
  );
  await login(pb);
  await pb.getByLabel('Patient QR Code', { exact: true }).fill(`D-client-${id}`);
  await pb.getByRole('button', { name: 'QR prüfen', exact: true }).click();
  await expect(pb).toHaveURL(new RegExp(`/patient/${id}$`));
  await pa.goto('/body/front');
  await pb.goto('/body/front');
  await expect(pa.getByRole('button', { name: 'kopf', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  return { a, b, pa, pb, id };
}
async function newerRemoval(pb: Page, id: number) {
  const marker = pb.getByRole('button', { name: 'kopf', exact: true });
  let response = pb.waitForResponse(
    (r) => r.url().includes('/api/body-parts') && r.request().method() === 'PUT',
  );
  await marker.click();
  expect((await response).status()).toBe(200);
  response = pb.waitForResponse(
    (r) => r.url().includes('/api/body-parts') && r.request().method() === 'PUT',
  );
  await marker.click();
  expect((await response).status()).toBe(200);
  expect(snapshot(id).body.body_parts.kopf_vorne).toBe(0);
}

test('two independent clients: late offline marker rejected after newer removal; lost rejection replay adds no audit', async ({
  browser,
}) => {
  const { a, b, pa, pb, id } = await twoClients(browser);
  await a.setOffline(true);
  await pa.getByRole('button', { name: 'kopf', exact: true }).click();
  await expect.poll(async () => (await items(pa)).length).toBe(1);
  const old = (await items(pa))[0];
  await pa.reload();
  expect((await items(pa))[0].writeId).toBe(old.writeId);
  await newerRemoval(pb, id);
  const requests: any[] = [];
  let rejectedState: any;
  await pa.route('**/api/body-parts', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    requests.push({
      key: route.request().headers()['idempotency-key'],
      body: route.request().postDataJSON(),
    });
    const response = await route.fetch({ maxRetries: 0 });
    const result = await response.json();
    expect(result.writeResult.outcome).toBe('rejected');
    expect(result.writeResult.serverValue).toBe(0);
    if (requests.length === 1) {
      rejectedState = snapshot(id);
      await a.setOffline(true);
      await route.abort('failed');
    } else await route.fulfill({ response });
  });
  await a.setOffline(false);
  await pa.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(async () => (await items(pa))[0]?.state).toBe('retrying');
  await pa.reload();
  await reconnect(pa, a);
  await expect(
    pa.getByRole('alert').filter({ hasText: 'kopf (vorne): Deine Änderung' }),
  ).toContainText('kopf (vorne): Deine Änderung wurde nicht übernommen');
  await expect(pa.getByRole('button', { name: 'kopf', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  requests.forEach((r) => expect(r).toEqual({ key: old.writeId, body: old.body }));
  expect(snapshot(id)).toEqual(rejectedState);
  const rejection = rejectedState.audit.find(
    (x: any) => x.after?.decision === 'rejected_older_edit',
  );
  expect(rejection).toBeTruthy();
  const after = rejection.after;
  const before = rejection.before;
  expect(before.value).toBe(0);
  expect(after.requested.value).toBe(1);
  expect(Date.parse(after.requested.clientUpdatedAt)).toBe(Date.parse(old.body.clientUpdatedAt));
  expect(Date.parse(before.clientUpdatedAt)).toBeGreaterThan(Date.parse(old.body.clientUpdatedAt));
  expect(after.writeId).toBe(old.writeId);
  expect(rejection.actor_id).toBeTruthy();
  expect(rejection.changed_fields).toContain('kopf_vorne');
  await evidence('two-client-conflict', {
    contexts: 2,
    old,
    requests,
    rejection,
    rejectedState,
    after: snapshot(id),
  });
  await a.close();
  await b.close();
});

test('two clients: delayed real conflict response preserves newer local region queue and display', async ({
  browser,
}) => {
  const { a, b, pa, pb, id } = await twoClients(browser);
  await a.setOffline(true);
  const marker = pa.getByRole('button', { name: 'kopf', exact: true });
  await marker.click();
  await expect.poll(async () => (await items(pa)).length).toBe(1);
  const old = (await items(pa))[0];
  await newerRemoval(pb, id);
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  let received = false;
  let server: any;
  await pa.route('**/api/body-parts', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    if (route.request().headers()['idempotency-key'] !== old.writeId)
      return route.abort('internetdisconnected');
    const response = await route.fetch({ maxRetries: 0 });
    const result = await response.json();
    expect(result.writeResult.outcome).toBe('rejected');
    server = snapshot(id);
    await a.setOffline(true);
    received = true;
    await hold;
    await route.fulfill({ response });
  });
  await a.setOffline(false);
  await pa.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => received).toBe(true);
  await marker.click();
  await marker.click();
  await expect.poll(async () => (await items(pa))[0]?.writeId).not.toBe(old.writeId);
  const newer = (await items(pa))[0];
  expect(newer.body.isClicked).toBe(true);
  release();
  await expect.poll(async () => (await items(pa))[0]?.writeId).toBe(newer.writeId);
  await expect(
    pa.getByRole('alert').filter({ hasText: 'kopf (vorne): Deine Änderung' }),
  ).toContainText('kopf (vorne): Deine Änderung wurde nicht übernommen');
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect((await items(pa))[0]).toEqual(newer);
  expect(snapshot(id)).toEqual(server);
  await evidence('delayed-response-local-protection', {
    contexts: 2,
    old,
    newer,
    queue: await items(pa),
    server,
  });
  await a.close();
  await b.close();
});
