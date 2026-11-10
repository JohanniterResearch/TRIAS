import { expect, Page, test } from '@playwright/test';

async function queued(page: Page): Promise<any[]> {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const opening = indexedDB.open('ambulanzsystem-offline', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction('queue');
          const read = tx.objectStore('queue').getAll();
          tx.oncomplete = () => {
            db.close();
            resolve(read.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
  );
}

test('body-map fallback, reload and retry preserve the original click time and writeId', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => {
    localStorage.setItem(
      'ambulanzsystem.auth.v1',
      JSON.stringify({
        admin: null,
        responder: { token: 'offline-test', tokenType: 'user', savedAt: new Date().toISOString() },
      }),
    );
    localStorage.setItem(
      'ambulanzsystem.responder.v1',
      JSON.stringify({
        scene: null,
        patient: { id: 7, operationSceneId: 1 },
      }),
    );
  });
  await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
  const writes: Array<{ body: any; key: string }> = [];
  await page.route('**/api/body-parts**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { idpatient: 7, bodyParts: { kopf_vorne: 0 } } });
      return;
    }
    writes.push({
      body: route.request().postDataJSON(),
      key: route.request().headers()['idempotency-key'],
    });
    if (writes.length === 1) {
      // The first send may already have reached the server; only its response is lost.
      await context.setOffline(true);
      await route.abort('failed');
    } else if (writes.length === 2) {
      await route.fulfill({ status: 503, json: { message: 'temporary outage' } });
    } else {
      await route.fulfill({ json: { idpatient: 7, bodyParts: { kopf_vorne: 1 } } });
    }
  });
  await page.goto('/body/front');
  await page.getByRole('button', { name: 'kopf', exact: true }).click();
  await expect.poll(async () => (await queued(page)).length).toBe(1);
  const original = (await queued(page))[0];
  expect(original.body.clientUpdatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  expect(original.writeId).toMatch(/^[0-9a-f-]{36}$/);
  expect(writes[0]).toEqual({ body: original.body, key: original.writeId });

  await page.reload();
  await expect.poll(async () => (await queued(page))[0]?.writeId).toBe(original.writeId);
  expect((await queued(page))[0].body).toEqual(original.body);
  await context.setOffline(false);
  await expect.poll(async () => (await queued(page))[0]?.state).toBe('retrying');
  const retrying = (await queued(page))[0];
  expect(retrying.body).toEqual(original.body);
  expect(retrying.writeId).toBe(original.writeId);
  await expect.poll(() => Date.now() >= Date.parse(retrying.nextAttemptAt)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await queued(page)).length).toBe(0);
  expect(writes).toHaveLength(3);
  for (const write of writes) expect(write).toEqual({ body: original.body, key: original.writeId });
});
