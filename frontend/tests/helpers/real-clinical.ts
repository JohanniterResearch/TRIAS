import { expect, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
export function sql(query: string): any {
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
export function snapshot(id: number) {
  return sql(`SELECT json_build_object(
    'patient',(SELECT row_to_json(p) FROM patients p WHERE id=${id}),
    'body',(SELECT row_to_json(b) FROM bodies b WHERE patient_id=${id}),
    'audit',(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM audit_logs a WHERE patient_id=${id} AND action='write'),
    'triage',(SELECT coalesce(json_agg(w),'[]') FROM triage_processed_writes w WHERE patient_id=${id}),
    'location',(SELECT coalesce(json_agg(w),'[]') FROM location_processed_writes w WHERE patient_id=${id}),
    'bodyKeys',(SELECT coalesce(json_agg(w),'[]') FROM body_part_processed_writes w WHERE patient_id=${id}))`);
}
export async function login(page: Page) {
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
export async function create(page: Page) {
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
