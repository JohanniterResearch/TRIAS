import { expect, Page, test, Route } from '@playwright/test';
import {
  kinds,
  endpoint,
  queued,
  openEditor,
  edit,
  answer,
  expectNewer,
} from '../helpers/clinical-writes';

async function setup(page: Page) {
  await page.goto('/login');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => {
    localStorage.setItem(
      'ambulanzsystem.auth.v1',
      JSON.stringify({
        admin: null,
        responder: {
          token: 'first-send-test',
          tokenType: 'user',
          savedAt: new Date().toISOString(),
        },
      }),
    );
    localStorage.setItem(
      'ambulanzsystem.responder.v1',
      JSON.stringify({
        scene: { id: 1 },
        patient: { id: 7, operationSceneId: 1, transport: false },
      }),
    );
  });
  await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
  await page.route('**/api/body-parts?**', (route) =>
    route.fulfill({ json: { idpatient: 7, bodyParts: { kopf_vorne: 0 } } }),
  );
}

for (const kind of kinds) {
  test(`${kind}: immediate reload during first pending request preserves durable UUID, payload and edit time`, async ({
    page,
  }) => {
    await setup(page);
    const requests: any[] = [];
    let durable: any;
    await page.route(endpoint(kind), async (route) => {
      if (route.request().method() === 'GET') return route.continue();
      const body = route.request().postDataJSON();
      requests.push({ key: route.request().headers()['idempotency-key'], body });
      if (requests.length === 1) {
        durable = (await queued(page)).find((x) => x.writeId === requests[0].key);
        return; // No error/response: the old fallback cannot have run before the reload.
      }
      await route.fulfill({ json: answer(kind, body) });
    });
    await openEditor(page, kind);
    await edit(page, kind);
    await expect.poll(() => durable).toBeTruthy();
    expect(durable.body).toEqual(requests[0].body);
    expect(durable.body.clientUpdatedAt).toMatch(/^\d{4}-.*Z$/);
    await page.reload();
    await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await queued(page)).length).toBe(0);
    for (const request of requests)
      expect(request).toEqual({ key: durable.writeId, body: durable.body });
    await test.info().attach(`${kind}-reload`, {
      body: JSON.stringify({ durable, requests }),
      contentType: 'application/json',
    });
  });

  test(`${kind}: late acknowledgement cannot delete or display over its successor`, async ({
    page,
  }) => {
    await setup(page);
    const held: Route[] = [];
    const requests: any[] = [];
    await page.route(endpoint(kind), (route) => {
      if (route.request().method() === 'GET') return route.continue();
      requests.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      held.push(route);
    });
    await openEditor(page, kind);
    await edit(page, kind);
    await expect.poll(() => held.length).toBe(1);
    await edit(page, kind, true);
    await expect
      .poll(async () => (await queued(page)).some((x) => x.writeId !== requests[0].key))
      .toBe(true);
    const newer = (await queued(page)).find((x) => x.writeId !== requests[0].key);
    await held[0].fulfill({ json: answer(kind, requests[0].body) });
    await expect.poll(() => held.length).toBe(2);
    expect(await queued(page)).toEqual([newer]);
    await expectNewer(page, kind);
    await held[1].fulfill({ json: answer(kind, requests[1].body) });
    await expect.poll(async () => (await queued(page)).length).toBe(0);
    await expectNewer(page, kind);
    expect(requests[1]).toEqual({ key: newer.writeId, body: newer.body });
  });

  test(`${kind}: aborted local commit prevents HTTP and storage retry retains the captured order`, async ({
    page,
  }) => {
    await setup(page);
    const requests: any[] = [];
    await page.route(endpoint(kind), (route) => {
      if (route.request().method() === 'GET') return route.continue();
      const body = route.request().postDataJSON();
      requests.push({ key: route.request().headers()['idempotency-key'], body });
      return route.fulfill({ json: answer(kind, body) });
    });
    await openEditor(page, kind);
    await page.evaluate((kind) => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: any, ...args: any[]) {
        const result = original.call(this, value, ...args);
        if (
          this.transaction.db.name === 'ambulanzsystem-offline' &&
          this.name === 'queue' &&
          value.type === kind &&
          !(window as any).abortedOrder
        ) {
          (window as any).abortedOrder = structuredClone(value);
          this.transaction.abort();
        }
        return result;
      };
    }, kind);
    await edit(page, kind);
    await expect(
      page.getByRole('alert').filter({ hasText: 'nicht dauerhaft gespeichert' }),
    ).toBeVisible();
    expect(requests).toHaveLength(0);
    const original = await page.evaluate(() => (window as any).abortedOrder);
    expect(await queued(page)).toHaveLength(0);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toEqual({ key: original.writeId, body: original.body });
    await expect.poll(async () => (await queued(page)).length).toBe(0);
  });
}
