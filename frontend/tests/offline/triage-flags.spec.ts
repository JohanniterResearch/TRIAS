import { expect, test } from '@playwright/test';

for (const serverTransport of [true, false]) {
  test(`offline checkbox reload and replay retain authoritative transport=${serverTransport}`, async ({
    context,
    page,
  }) => {
    const patient = {
      id: 7,
      operationSceneId: 1,
      atmung: true,
      blutung: true,
      radialispuls: null,
      transport: false,
      dringend: null,
      kontaminiert: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await page.goto('/login');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate((patient) => {
      localStorage.setItem(
        'ambulanzsystem.auth.v1',
        JSON.stringify({
          admin: null,
          responder: {
            token: 'offline-test-token',
            tokenType: 'user',
            savedAt: new Date().toISOString(),
          },
        }),
      );
      localStorage.setItem('ambulanzsystem.responder.v1', JSON.stringify({ scene: null, patient }));
      localStorage.setItem(
        'ambulanzsystem.triage-drafts.v1',
        JSON.stringify({ 7: { respiration: false, blutung: false } }),
      );
    }, patient);
    await context.setOffline(true);
    await page.goto('/triage');
    await expect(page.getByLabel('Atmung', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Blutung', { exact: true })).toBeChecked();
    await page.getByLabel('Transport', { exact: true }).check();
    await expect(
      page.getByRole('status').filter({ hasText: 'Lokal gespeichert, Sync ausstehend.' }),
    ).toBeVisible();

    const pending = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('ambulanzsystem-offline');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<any[]>((resolve, reject) => {
          const request = db.transaction('queue').objectStore('queue').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].body).toEqual({ transport: true, clientUpdatedAt: expect.any(String) });

    await page.reload();
    await expect(page.getByLabel('Transport', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Atmung', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Blutung', { exact: true })).toBeChecked();
    const writes: object[] = [];
    await page.route('**/api/persons/7/update-triage-color', async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      await route.fulfill({ json: { ...patient, ...body, transport: serverTransport } });
    });
    await page.route('**/api/validate-token', (route) => route.fulfill({ json: { role: 'user' } }));
    await context.setOffline(false);
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ transport: true, clientUpdatedAt: expect.any(String) });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open('ambulanzsystem-offline');
            request.onsuccess = () => resolve(request.result);
          });
          try {
            return await new Promise<number>((resolve) => {
              const request = db.transaction('queue').objectStore('queue').count();
              request.onsuccess = () => resolve(request.result);
            });
          } finally {
            db.close();
          }
        }),
      )
      .toBe(0);
    await expect(page.getByLabel('Transport', { exact: true })).toBeChecked({
      checked: serverTransport,
    });
    await page.reload();
    await expect(page.getByLabel('Transport', { exact: true })).toBeChecked({
      checked: serverTransport,
    });
    await expect(page.getByLabel('Atmung', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Blutung', { exact: true })).toBeChecked();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem('ambulanzsystem.responder.v1')!).patient.radialispuls,
      ),
    ).toBeNull();
  });
}
