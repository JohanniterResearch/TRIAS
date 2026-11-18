import { expect, Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { kinds, endpoint, queued, openEditor, edit, Kind } from '../helpers/clinical-writes';

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
function snapshot(id: number) {
  return sql(`SELECT json_build_object(
    'patient',(SELECT row_to_json(p) FROM patients p WHERE id=${id}),
    'body',(SELECT row_to_json(b) FROM bodies b WHERE patient_id=${id}),
    'audit',(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM audit_logs a WHERE patient_id=${id} AND action='write'),
    'triage',(SELECT coalesce(json_agg(w),'[]') FROM triage_processed_writes w WHERE patient_id=${id}),
    'location',(SELECT coalesce(json_agg(w),'[]') FROM location_processed_writes w WHERE patient_id=${id}),
    'bodyKeys',(SELECT coalesce(json_agg(w),'[]') FROM body_part_processed_writes w WHERE patient_id=${id}))`);
}
async function login(page: Page) {
  await page
    .context()
    .setExtraHTTPHeaders({ 'X-Forwarded-For': `127.0.3.${Math.floor(Math.random() * 200) + 1}` });
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByLabel('Benutzername', { exact: true }).fill('responder-demo');
  await page.getByLabel('Passwort', { exact: true }).fill('responder-demo');
  await page.getByRole('button', { name: 'Mit Passwort einloggen', exact: true }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
  await page.locator('.choice-grid button').filter({ hasText: 'Paket D upgrade' }).click();
}
async function create(page: Page) {
  await page.getByLabel('Name optional').fill(`first-send-${Date.now()}`);
  await page.getByRole('button', { name: 'Manuellen Patienten anlegen', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1')!).patient?.id ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/patient\/\d+$/);
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1')!).patient.id,
  );
}

for (const mode of [...kinds, 'intake-location', 'qr-intake-location'] as const) {
  test(`${mode}: committed first answer held, immediate reload replays the durable order exactly once`, async ({
    page,
    context,
  }) => {
    const intake = mode === 'intake-location' || mode === 'qr-intake-location';
    const kind: Kind = intake ? 'location' : mode;
    await login(page);
    let id = 0;
    if (mode !== 'intake-location') id = await create(page);
    if (intake) {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: 48.21, longitude: 16.31, accuracy: 5 });
    }
    if (mode === 'qr-intake-location') {
      sql(
        `INSERT INTO qr_code_patients(qr_token,patient_id,operation_scene_id,created_at,updated_at) VALUES ('first-send-qr-${id}',${id},9000,now(),now()) RETURNING id`,
      );
      await page.goto('/scan-patient');
    }
    const requests: any[] = [];
    let durable: any;
    let committed: any;
    let firstResponse: any;
    await page.route(endpoint(kind), async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      const request = {
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      };
      requests.push(request);
      const attempt = requests.length;
      if (attempt === 1) {
        durable = (await queued(page)).find((x) => x.writeId === request.key);
        expect(durable).toBeTruthy();
        expect(durable.body).toEqual(request.body);
        id =
          kind === 'body-part'
            ? request.body.idpatient
            : Number(
                route
                  .request()
                  .url()
                  .match(/persons\/(\d+)/)![1],
              );
      }
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(200);
      if (attempt === 1) {
        firstResponse = await response.json();
        committed = snapshot(id);
        return; // Server committed; no response or failure has reached the old document.
      }
      await route.fulfill({ response });
    });
    if (mode === 'intake-location') await create(page);
    else if (mode === 'qr-intake-location') {
      await page.getByLabel('Patient QR Code', { exact: true }).fill(`first-send-qr-${id}`);
      await page.getByRole('button', { name: 'QR prüfen', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/patient/${id}$`));
    } else {
      await openEditor(page, kind);
      await edit(page, kind);
    }
    await expect.poll(() => committed).toBeTruthy();
    const relevantAudit = committed.audit.filter((a: any) =>
      kind === 'body-part'
        ? a.entity_type === 'body'
        : a.changed_fields?.includes(kind === 'location' ? 'location' : 'transport'),
    );
    expect(relevantAudit).toHaveLength(1);
    const keys = committed[kind === 'body-part' ? 'bodyKeys' : kind];
    expect(keys.filter((w: any) => w.write_id === durable.writeId)).toHaveLength(1);
    await page.reload();
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await queued(page)).length).toBe(0);
    for (const request of requests)
      expect(request).toEqual({ key: durable.writeId, body: durable.body });
    expect(snapshot(id)).toEqual(committed);
    await test.info().attach(`${mode}-real-evidence`, {
      body: JSON.stringify(
        { requests, durable, firstResponse, committed, after: snapshot(id) },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}
