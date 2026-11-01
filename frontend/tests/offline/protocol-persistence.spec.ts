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

for (const newer of [false, true]) {
  test(`loaded legacy protocol receives its acknowledgement without reload (newer=${newer})`, async ({
    page,
    context,
  }) => {
    await openProtocol(page);
    await context.setOffline(true);
    await page.getByLabel('Vorname', { exact: true }).fill('Loaded legacy snapshot');
    await page
      .getByRole('button', { name: newer ? 'Speichern' : 'Finalisieren', exact: true })
      .click();
    await expect
      .poll(async () => (await queued(page))[0]?.body.status)
      .toBe(newer ? 'draft' : 'finalized');
    await page.getByRole('link', { name: 'Alle Seiten' }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const opening = indexedDB.open('ambulanzsystem-offline', 1);
          opening.onerror = () => reject(opening.error);
          opening.onsuccess = () => {
            const db = opening.result;
            const tx = db.transaction('queue', 'readwrite');
            const store = tx.objectStore('queue');
            const read = store.get('protocol:7');
            read.onsuccess = () => {
              const item = read.result;
              delete item.writeId;
              store.put(item);
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error);
            };
          };
        }),
    );
    const legacy = (await queued(page))[0];
    expect(legacy.writeId).toBeUndefined();
    await page.goBack();
    await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Loaded legacy snapshot');
    const uploads: Array<{ key: string | undefined; body: any }> = [];
    let acknowledgeOld!: () => Promise<void>;
    let acknowledgeNew!: () => Promise<void>;
    const serverFinalizedAt = '2026-11-01T12:34:56Z';
    await page.route('**/api/persons/7/ambulanzprotokoll-page1', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const key = route.request().headers()['idempotency-key'];
      const body = route.request().postDataJSON();
      expect((await queued(page))[0].writeId).toBe(key);
      uploads.push({ key, body });
      const response = {
        ...body,
        patientId: 7,
        updatedAt: serverFinalizedAt,
        finalizedAt: body.status === 'finalized' ? serverFinalizedAt : null,
        warnings: [uploads.length === 1 ? 'Legacy server warning' : 'New server warning'],
      };
      if (uploads.length === 1) {
        acknowledgeOld = () => route.fulfill({ json: response });
        return;
      }
      acknowledgeNew = () => route.fulfill({ json: response });
    });
    await context.setOffline(false);
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0].body).toEqual(legacy.body);
    expect(uploads[0].key).toMatch(/^[0-9a-f-]{36}$/);
    if (newer) {
      await context.setOffline(true);
      await page.getByLabel('Vorname', { exact: true }).fill('Newer local edit');
      await page.getByRole('button', { name: 'Finalisieren', exact: true }).click();
      await expect.poll(async () => (await queued(page))[0]?.body.status).toBe('finalized');
      const replacement = (await queued(page))[0];
      expect(replacement.writeId).not.toBe(uploads[0].key);
      await acknowledgeOld();
      await context.setOffline(false);
      // The next upload can only start once the old response has finished queue processing.
      await expect.poll(() => uploads.length).toBe(2);
      await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Newer local edit');
      await expect(page.getByText('Finalisiert', { exact: true })).toBeVisible();
      expect((await queued(page))[0]).toEqual(replacement);
      await expect(page.getByText('Legacy server warning', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/^server /)).toHaveCount(0);
      await acknowledgeNew();
      await expect(page.getByText('New server warning', { exact: true })).toBeVisible();
      expect(uploads[1].body).toEqual(replacement.body);
    } else {
      await acknowledgeOld();
      await expect(page.getByText('Legacy server warning', { exact: true })).toBeVisible();
      await expect(page.getByText(/^server /)).toBeVisible();
    }
    await expect.poll(() => queued(page)).toHaveLength(0);
  });
}

for (const legacy of [false, true]) {
  test(`lost finalize response retains key and body across reload (legacy=${legacy})`, async ({
    page,
    context,
  }) => {
    await openProtocol(page);
    const uploaded: Array<{ key: string | undefined; body: any }> = [];
    await page.route('**/api/persons/7/ambulanzprotokoll-page1', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      const key = route.request().headers()['idempotency-key'];
      const body = route.request().postDataJSON();
      // Even a legacy key must already be committed to IndexedDB when HTTP begins.
      expect((await queued(page))[0].writeId).toBe(key);
      uploaded.push({ key, body });
      if (uploaded.length === 1) return route.abort('connectionfailed');
      return route.fulfill({
        json: {
          ...body,
          patientId: 7,
          warnings: [],
          updatedAt: body.clientUpdatedAt,
          finalizedAt: body.clientUpdatedAt,
        },
      });
    });
    await context.setOffline(true);
    await page.getByLabel('Vorname', { exact: true }).fill('Durable finalization');
    await page.getByRole('button', { name: 'Finalisieren', exact: true }).click();
    await expect.poll(async () => (await queued(page))[0]?.body.status).toBe('finalized');
    if (legacy) {
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const opening = indexedDB.open('ambulanzsystem-offline', 1);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
              const db = opening.result;
              const tx = db.transaction('queue', 'readwrite');
              const store = tx.objectStore('queue');
              const read = store.get('protocol:7');
              read.onsuccess = () => {
                const item = read.result;
                delete item.writeId;
                store.put(item);
              };
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onabort = () => {
                db.close();
                reject(tx.error);
              };
            };
          }),
      );
    }
    const original = (await queued(page))[0];
    await context.setOffline(false);
    await expect.poll(() => uploaded.length).toBe(1);
    await expect.poll(async () => (await queued(page))[0]?.state).toBe('retrying');
    const pending = (await queued(page))[0];
    expect(pending.writeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(pending.body).toEqual(original.body);
    if (!legacy) expect(pending.writeId).toBe(original.writeId);
    await expect.poll(() => Date.now()).toBeGreaterThan(Date.parse(pending.nextAttemptAt));
    await page.reload();
    await expect.poll(() => uploaded.length).toBe(2);
    expect(uploaded[0]).toEqual({ key: pending.writeId, body: original.body });
    expect(uploaded[1]).toEqual(uploaded[0]);
    await expect.poll(() => queued(page)).toHaveLength(0);
  });
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
