import { expect, test } from '@playwright/test';
import { queued, openEditor, edit } from '../helpers/clinical-writes';
import { login, create, sql } from '../helpers/real-clinical';

for (const kind of ['triage', 'location', 'protocol'] as const) {
  for (const mode of ['reload', 'late'] as const) {
    test(`${kind}: rejected older order, ${mode}, UI and transactional audit`, async ({ page }) => {
      await login(page);
      const id = await create(page);
      const protocol = kind === 'protocol';
      const suffix = protocol
        ? 'ambulanzprotokoll-page1'
        : kind === 'triage'
          ? 'update-triage-color'
          : 'location';
      const path = `/api/persons/${id}/${suffix}`;
      if (protocol) {
        await page.goto(`/ambulanzprotokoll/${id}`);
        await expect(page.getByLabel('Vorname', { exact: true })).toBeVisible();
      } else await openEditor(page, kind);
      const token = await page.evaluate(
        () => JSON.parse(localStorage.getItem('ambulanzsystem.auth.v1')!).responder.token,
      );
      const requests: any[] = [];
      let committed: any;
      let firstResult: any;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const snapshot = () =>
        sql(`SELECT json_build_object(
        'patient',(SELECT row_to_json(p) FROM patients p WHERE id=${id}),
        'protocol',(SELECT row_to_json(p) FROM ambulanzprotokoll_page1s p WHERE patient_id=${id}),
        'audit',(SELECT coalesce(json_agg(a ORDER BY id),'[]') FROM audit_logs a WHERE patient_id=${id} AND action='write'),
        'receipt',(SELECT coalesce(json_agg(w),'[]') FROM ${protocol ? 'protokoll' : kind}_processed_writes w WHERE patient_id=${id}),
        'revisions',(SELECT count(*) FROM ambulanzprotokoll_revisions WHERE patient_id=${id}))`);
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() === 'GET') return route.continue();
        const order = {
          key: route.request().headers()['idempotency-key'],
          body: route.request().postDataJSON(),
        };
        requests.push(order);
        if (requests.length === 1) {
          expect((await queued(page)).some((item) => item.writeId === order.key)).toBe(true);
          // A second client saves after this device captured its input, before delivery.
          const serverOrder = protocol
            ? {
                status: 'draft',
                formState: { patient: { vorname: 'Server' } },
                clientUpdatedAt: new Date().toISOString(),
              }
            : kind === 'triage'
              ? { transport: false, clientUpdatedAt: new Date().toISOString() }
              : {
                  lat: 0,
                  lng: 0,
                  source: 'manual',
                  accuracyMeters: 0,
                  indoorLocation: null,
                  clientUpdatedAt: new Date().toISOString(),
                };
          const serverResponse = await page.request.fetch(path, {
            method: protocol ? 'PUT' : 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
            data: serverOrder,
          });
          expect(serverResponse.status()).toBe(200);
        }
        const response = await route.fetch({ maxRetries: 0 });
        expect(response.status()).toBe(200);
        if (requests.length === 1) {
          firstResult = await response.json();
          committed = snapshot();
          if (mode === 'reload') return; // DB commit succeeded, answer lost before acknowledgement.
          await gate;
        } else if (mode === 'late') {
          await gate;
          return; // Keep the successor pending so the old response's effects are observable.
        }
        await route.fulfill({ response });
      });
      if (protocol) await page.getByLabel('Vorname', { exact: true }).fill('Alt');
      else await edit(page, kind);
      await expect.poll(() => committed).toBeTruthy();
      const rejected = firstResult.fieldResults.filter((r: any) => r.outcome === 'rejected');
      expect(rejected).toEqual([
        expect.objectContaining({
          field: protocol ? 'patient.vorname' : kind === 'triage' ? 'transport' : 'location',
          conflictReason: 'older_edit',
        }),
      ]);
      const details = committed.audit.flatMap((a: any) =>
        a.write_details_json ? [a.write_details_json].flat() : [],
      );
      const conflict = details.find(
        (d: any) => d.writeId === requests[0].key && d.decision === 'rejected_older_edit',
      );
      expect(conflict).toBeTruthy();
      expect(Date.parse(conflict.requestedUpdatedAt)).toBe(
        Date.parse(requests[0].body.clientUpdatedAt),
      );
      expect(conflict.storedUpdatedAt).toBeTruthy();
      expect(conflict.resultValue).toEqual(conflict.storedValue);
      expect(conflict.requestedValue).not.toEqual(conflict.storedValue);
      if (mode === 'reload') {
        await page.reload();
        await expect.poll(() => requests.length).toBeGreaterThanOrEqual(2);
        await expect.poll(async () => (await queued(page)).length).toBe(0);
        expect(requests[1]).toEqual(requests[0]);
        expect(snapshot()).toEqual(committed);
        if (protocol)
          await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Server');
        else if (kind === 'triage')
          await expect(page.getByLabel('Transport', { exact: true })).not.toBeChecked();
        else await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('0');
      } else {
        if (protocol) await page.getByLabel('Vorname', { exact: true }).fill('Neu');
        else {
          await edit(page, kind, true);
          if (kind === 'triage')
            await page.getByLabel('Transport', { exact: true }).setChecked(true);
        }
        await expect
          .poll(async () => (await queued(page)).some((q) => q.writeId !== requests[0].key))
          .toBe(true);
        release();
        if (protocol) await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Neu');
        else if (kind === 'location')
          await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('48.3');
        else await expect(page.getByLabel('Transport', { exact: true })).toBeChecked();
        await expect
          .poll(async () => (await queued(page)).some((q) => q.writeId !== requests[0].key))
          .toBe(true);
      }
      const message = protocol
        ? 'Vorname: Neuere Eingabe am Server'
        : kind === 'triage'
          ? 'Transport: Neuere Eingabe am Server'
          : 'Patientenstandort: Neuere Eingabe am Server';
      await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
      if (protocol)
        await expect(
          page.getByRole('alert').filter({ hasText: 'Nur ein Teil der Änderungen' }),
        ).toBeVisible();
      if (mode === 'late') {
        if (protocol) await expect(page.getByLabel('Vorname', { exact: true })).toHaveValue('Neu');
        else if (kind === 'location')
          await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('48.3');
        else await expect(page.getByLabel('Transport', { exact: true })).toBeChecked();
        await expect
          .poll(async () => (await queued(page)).some((q) => q.writeId === requests[0].key))
          .toBe(false);
      }
      await test.info().attach('real-conflict-evidence', {
        body: JSON.stringify({ requests, firstResult, committed, after: snapshot() }, null, 2),
        contentType: 'application/json',
      });
    });
  }
}
