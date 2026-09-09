import { expect, Page, test } from '@playwright/test';

async function openProtocol(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() =>
    localStorage.setItem(
      'ambulanzsystem.auth.v1',
      JSON.stringify({
        admin: null,
        responder: {
          token: 'offline-test',
          tokenType: 'user',
          username: 'offline-test',
          savedAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
  await page.route('**/api/persons/7/ambulanzprotokoll-page1', (route) =>
    route.fulfill({
      json: {
        patientId: 7,
        status: 'draft',
        updatedAt: '2026-01-01T00:00:00Z',
        finalizedAt: null,
        warnings: [],
        formState: { patient: { vorname: 'Server' } },
      },
    }),
  );
  await page.goto('/ambulanzprotokoll/7');
  await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Server');
}

async function queued(page: Page): Promise<any[]> {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const opening = indexedDB.open('ambulanzsystem-offline', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const transaction = db.transaction('queue');
          const request = transaction.objectStore('queue').getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
}

test('edit then navigate before 800 ms survives offline reload and reconnect', async ({
  page,
  context,
}) => {
  await openProtocol(page);
  const uploaded: any[] = [];
  await page.route('**/api/persons/7/ambulanzprotokoll-page1', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    uploaded.push(body);
    await route.fulfill({
      json: {
        ...body,
        patientId: 7,
        warnings: [],
        updatedAt: body.clientUpdatedAt,
        finalizedAt: null,
      },
    });
  });
  await page.clock.install({ time: new Date('2026-09-07T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-07T12:00:01Z'));
  await context.setOffline(true);
  await page.getByLabel('Vorname', { exact: true }).fill('Latest offline snapshot');
  await page.getByRole('link', { name: 'Alle Seiten' }).click();
  await expect(page).toHaveURL(/\/menu$/);
  await expect
    .poll(async () => (await queued(page))[0]?.body.formState.patient.vorname)
    .toBe('Latest offline snapshot');
  expect(uploaded).toHaveLength(0);
  await page.clock.resume();
  await page.reload();
  await page.goto('/ambulanzprotokoll/7');
  await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Latest offline snapshot');
  await expect(page.getByRole('button', { name: 'Zugang beenden' })).toBeDisabled();
  await context.setOffline(false);
  await expect.poll(() => uploaded.length).toBe(1);
  await expect.poll(() => queued(page)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Zugang beenden' })).toBeEnabled();
});

test('transaction abort after request success remains unsaved and blocks logout until retry', async ({
  page,
}) => {
  await openProtocol(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).abortProtocolStorage = true;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      const request =
        key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (
        this.name === 'queue' &&
        value.type === 'protocol' &&
        (window as any).abortProtocolStorage
      ) {
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    };
  });
  await page.getByLabel('Vorname', { exact: true }).fill('Retain after failed storage');
  await expect(page.getByText('local-only, queue failed', { exact: true })).toBeVisible();
  await expect.poll(() => queued(page)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Zugang beenden' })).toBeDisabled();
  await page.getByRole('link', { name: 'Alle Seiten' }).click();
  await page.goBack();
  await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue(
    'Retain after failed storage',
  );
  const uploaded: any[] = [];
  await page.route('**/api/persons/7/ambulanzprotokoll-page1', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    uploaded.push(body);
    await route.fulfill({
      json: { ...body, warnings: [], updatedAt: body.clientUpdatedAt, finalizedAt: null },
    });
  });
  await page.evaluate(() => {
    (window as any).abortProtocolStorage = false;
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => uploaded.length).toBe(1);
  expect(uploaded[0].formState.patient.vorname).toBe('Retain after failed storage');
  await expect(page.getByRole('button', { name: 'Zugang beenden' })).toBeEnabled();
});

test('newer replacement survives an in-flight save and finalization retains server warnings', async ({
  page,
}) => {
  await openProtocol(page);
  const acknowledgements: Array<() => Promise<void>> = [];
  const uploaded: any[] = [];
  await page.route('**/api/persons/7/ambulanzprotokoll-page1', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    uploaded.push(body);
    const sequence = uploaded.length;
    const complete = () =>
      route.fulfill({
        json: {
          ...body,
          warnings: [`Server warning ${sequence}`],
          updatedAt: new Date(Date.now() + 60_000).toISOString(),
          finalizedAt: body.status === 'finalized' ? '2026-09-07T12:01:00Z' : null,
        },
      });
    acknowledgements.push(complete);
  });
  await page.getByLabel('Vorname', { exact: true }).fill('First');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(() => uploaded.length).toBe(1);
  await page.getByLabel('Vorname', { exact: true }).fill('Replacement');
  await page.getByRole('button', { name: 'Finalisieren', exact: true }).click();
  await expect.poll(async () => (await queued(page))[0]?.body.status).toBe('finalized');
  await acknowledgements[0]();
  await expect.poll(() => uploaded.length).toBe(2);
  await page.getByRole('link', { name: 'Alle Seiten' }).click();
  await page.goBack();
  await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Replacement');
  await expect(page.getByText('Server warning 1', { exact: true })).toHaveCount(0);
  await acknowledgements[1]();
  await expect(page.getByText('Server warning 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Server warning 1', { exact: true })).toHaveCount(0);
  expect(uploaded[1].formState.patient.vorname).toBe('Replacement');
  await expect.poll(() => queued(page)).toHaveLength(0);
  await page.reload();
  await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Replacement');
  await expect(page.getByText('Server warning 2', { exact: true })).toBeVisible();
});
