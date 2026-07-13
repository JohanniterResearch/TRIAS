import { expect, Page, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('persisted forced-password sessions cannot enter protected routes', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Benutzername').fill('admin');
  await page.getByLabel('Passwort').fill('dev-admin-password');
  await page.getByRole('button', { name: 'Einloggen' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto('/admin/login');
  await expect(page).toHaveURL(/\/change-password$/);
});

test('temporary validation outage preserves the local workspace', async ({ page }) => {
  await loginResponder(page);
  await page.evaluate(() => localStorage.setItem('ambulanzsystem.triage-drafts.v1', JSON.stringify({ 1: { notes: 'retain' } })));
  await page.route('**/api/validate-token', (route) => route.abort('connectionfailed'));
  await page.goto('/scan-patient');
  await expect(page).toHaveURL(/\/scan-patient$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ambulanzsystem.triage-drafts.v1'))).toContain('retain');
});

async function loginResponder(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'DEV Responder' }).click();
  await expect(page).toHaveURL(/\/role-selection$/);
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
  expect((await page.getByRole('button', { name: 'Rot', exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
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
  expect(await page.locator('.protocol-page input, .protocol-page textarea, .protocol-page select, .protocol-page button').count()).toBeGreaterThan(100);
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
  await commandPage.goto('/admin/login');
  await commandPage.getByRole('button', { name: 'DEV Admin' }).click();
  await expect(commandPage).toHaveURL(/\/admin$/);
  await commandPage.goto('/situation-room');
  await commandPage.getByLabel('Szene ID').fill(String(sceneId));
  await commandPage.getByRole('button', { name: 'Öffnen' }).click();
  const row = commandPage.locator('tbody tr').filter({ hasText: patient.label });
  await expect(row).toBeVisible();

  await responderPage.getByRole('link', { name: 'Triage', exact: true }).click();
  await responderPage.getByRole('button', { name: 'Schwarz', exact: true }).click();
  await expect(row).toContainText('schwarz', { timeout: 15_000 });

  await responder.close();
  await command.close();
});
