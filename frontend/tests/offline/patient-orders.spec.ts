import { expect, Page, test } from '@playwright/test';

async function items(page: Page, name: string, store: string): Promise<any[]> {
  return page.evaluate(
    ({ name, store }) =>
      new Promise<any[]>((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const tx = db.transaction(store);
          const read = tx.objectStore(store).getAll();
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
    { name, store },
  );
}

for (const manual of [true, false]) {
  test(`${manual ? 'manual intake' : 'QR order'} is durable before first send and keeps identity after reload`, async ({
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
          responder: {
            token: 'offline-test',
            tokenType: 'user',
            username: 'tester',
            savedAt: new Date().toISOString(),
          },
        }),
      );
      localStorage.setItem(
        'ambulanzsystem.responder.v1',
        JSON.stringify({ scene: { id: 1, name: 'Test' }, patient: null }),
      );
    });
    await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
    const writes: Array<{ key?: string; body: any }> = [];
    let recover = false;
    const endpoint = manual ? '**/api/persons/manual' : '**/api/verify-patient-qr-code';
    await page.route(endpoint, async (route) => {
      const body = route.request().postDataJSON();
      const key = route.request().headers()['idempotency-key'];
      writes.push({ key, body });
      // Inspect real IndexedDB at the first HTTP attempt, not just after a failed response.
      const saved = await items(
        page,
        manual ? 'ambulanzsystem-offline' : 'ambulanzsystem-patient-writes',
        manual ? 'queue' : 'orders',
      );
      expect(
        saved.some((item) =>
          manual ? item.body.clientGeneratedId === body.clientGeneratedId : item.writeId === key,
        ),
      ).toBe(true);
      if (!recover) {
        await context.setOffline(true);
        await route.abort('failed');
        return;
      }
      const patient = {
        id: 42,
        operationSceneId: 1,
        humanReadableId: 'TEST42',
        clientGeneratedId: body.clientGeneratedId,
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
      };
      await route.fulfill({ json: manual ? patient : { patient, created: true } });
    });
    await page.goto('/scan-patient');
    if (manual) {
      await page.getByLabel('Name optional').fill('Persisted name');
      await page.getByRole('button', { name: 'Manuellen Patienten anlegen', exact: true }).click();
    } else {
      await page.getByLabel('Patient QR Code', { exact: true }).fill('original-qr');
      await page.getByRole('button', { name: 'QR prüfen', exact: true }).click();
    }
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    const original = writes[0];
    await page.reload();
    recover = true;
    // Respect the queue's persisted backoff after the intentionally lost response.
    const saved = await items(
      page,
      manual ? 'ambulanzsystem-offline' : 'ambulanzsystem-patient-writes',
      manual ? 'queue' : 'orders',
    );
    if (saved[0]?.nextAttemptAt)
      await expect.poll(() => Date.now() >= Date.parse(saved[0].nextAttemptAt)).toBe(true);
    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (
            await items(
              page,
              manual ? 'ambulanzsystem-offline' : 'ambulanzsystem-patient-writes',
              manual ? 'queue' : 'orders',
            )
          ).length,
      )
      .toBe(0);
    expect(writes.length).toBeGreaterThan(1);
    for (const write of writes) expect(write).toEqual(original);
    if (manual) expect(original.body.clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
    else expect(original.key).toMatch(/^[0-9a-f-]{36}$/);
  });
}
