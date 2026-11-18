import { expect, Page, Route, test } from '@playwright/test';

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
  await expect.poll(async () => (await queued(page))[0]?.attemptCount).toBe(1);
  const original = (await queued(page))[0];
  expect(original.body.clientUpdatedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  expect(original.writeId).toMatch(/^[0-9a-f-]{36}$/);
  expect(writes[0]).toEqual({ body: original.body, key: original.writeId });

  await page.reload();
  await expect.poll(async () => (await queued(page))[0]?.writeId).toBe(original.writeId);
  expect((await queued(page))[0].body).toEqual(original.body);
  await expect.poll(() => Date.now() >= Date.parse(original.nextAttemptAt)).toBe(true);
  await context.setOffline(false);
  await expect.poll(async () => (await queued(page))[0]?.attemptCount).toBe(2);
  const retrying = (await queued(page))[0];
  expect(retrying.body).toEqual(original.body);
  expect(retrying.writeId).toBe(original.writeId);
  await expect.poll(() => Date.now() >= Date.parse(retrying.nextAttemptAt)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await queued(page)).length).toBe(0);
  expect(writes).toHaveLength(3);
  for (const write of writes) expect(write).toEqual({ body: original.body, key: original.writeId });
});

async function openBodyMap(
  page: Page,
  handleWrite: (route: Route) => Promise<void>,
): Promise<void> {
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
      JSON.stringify({ scene: null, patient: { id: 7, operationSceneId: 1 } }),
    );
  });
  await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
  await page.route('**/api/body-parts**', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { idpatient: 7, bodyParts: { kopf_vorne: 0 } } })
      : handleWrite(route),
  );
  await page.goto('/body/front');
  await expect(page.getByRole('button', { name: 'kopf', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
}

function rejected(serverValue: number) {
  return {
    idpatient: 7,
    bodyParts: { kopf_vorne: serverValue },
    writeResult: {
      outcome: 'rejected',
      conflictReason: 'older_edit',
      bodyPartId: 'kopf_vorne',
      serverValue,
    },
  };
}

for (const serverValue of [0, 1]) {
  test(`online rejection shows region message and server value ${serverValue}`, async ({
    page,
  }) => {
    await openBodyMap(page, (route) => route.fulfill({ json: rejected(serverValue) }));
    await page.getByRole('button', { name: 'kopf', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'kopf (vorne): Deine Änderung' }),
    ).toContainText('kopf (vorne): Deine Änderung wurde nicht übernommen');
    await expect(page.getByRole('button', { name: 'kopf', exact: true })).toHaveAttribute(
      'aria-pressed',
      String(serverValue === 1),
    );
    expect(await queued(page)).toHaveLength(0);
  });
}

for (const serverValue of [0, 1]) {
  test(`offline rejection survives reload and lost response, then shows retry value ${serverValue}`, async ({
    page,
    context,
  }) => {
    const writes: Array<{ key: string; body: any }> = [];
    await openBodyMap(page, async (route) => {
      writes.push({
        key: route.request().headers()['idempotency-key'],
        body: route.request().postDataJSON(),
      });
      if (writes.length <= 2) {
        // First transport failure queues the edit; the second loses its rejection response.
        await context.setOffline(true);
        await route.abort('failed');
      } else {
        // The original decision remains rejection although the current region changed to 1.
        await route.fulfill({ json: rejected(serverValue) });
      }
    });
    const marker = page.getByRole('button', { name: 'kopf', exact: true });
    await marker.click();
    await expect.poll(async () => (await queued(page))[0]?.attemptCount).toBe(1);
    await page.reload();
    await expect(marker).toHaveAttribute('aria-pressed', 'true');
    const first = (await queued(page))[0];
    await expect.poll(() => Date.now() >= Date.parse(first.nextAttemptAt)).toBe(true);
    await context.setOffline(false);
    await expect.poll(() => writes.length).toBe(2);
    await expect.poll(async () => (await queued(page))[0]?.attemptCount).toBe(2);
    const item = (await queued(page))[0];
    await expect.poll(() => Date.now() >= Date.parse(item.nextAttemptAt)).toBe(true);
    await context.setOffline(false);
    await expect.poll(async () => (await queued(page)).length).toBe(0);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Deine Änderung wurde nicht übernommen' }),
    ).toContainText('kopf (vorne)');
    await expect(marker).toHaveAttribute('aria-pressed', String(serverValue === 1));
    expect(writes).toHaveLength(3);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[2]).toEqual(writes[0]);
  });
}

test('late offline rejection keeps a newer local UUID, queue item and displayed value', async ({
  page,
  context,
}) => {
  let count = 0;
  let held: Route | undefined;
  await openBodyMap(page, async (route) => {
    count++;
    if (count === 2) {
      held = route;
      return;
    }
    if (count === 1) await context.setOffline(true);
    await route.abort('failed');
  });
  const marker = page.getByRole('button', { name: 'kopf', exact: true });
  await marker.click();
  await expect.poll(async () => (await queued(page))[0]?.attemptCount).toBe(1);
  const original = (await queued(page))[0];
  await page.reload();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => Date.now() >= Date.parse(original.nextAttemptAt)).toBe(true);
  await context.setOffline(false);
  await expect.poll(() => !!held).toBe(true);
  await marker.click(); // Newer intent: 0, while the delayed server response says 1.
  await expect.poll(async () => (await queued(page))[0]?.writeId).not.toBe(original.writeId);
  const newer = (await queued(page))[0];
  expect(newer.body.isClicked).toBe(false);
  await held!.fulfill({ json: rejected(1) });
  await expect(
    page.getByRole('alert').filter({ hasText: 'Deine Änderung wurde nicht übernommen' }),
  ).toBeVisible();
  await expect(marker).toHaveAttribute('aria-pressed', 'false');
  const remaining = await queued(page);
  expect(remaining).toHaveLength(1);
  expect(remaining[0].writeId).toBe(newer.writeId);
  expect(remaining[0].body).toEqual(newer.body);
});
