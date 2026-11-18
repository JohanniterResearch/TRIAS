import { expect, Page } from '@playwright/test';
export const kinds = ['triage', 'location', 'body-part'] as const;
export type Kind = (typeof kinds)[number];
export function endpoint(kind: Kind) {
  return kind === 'body-part'
    ? '**/api/body-parts'
    : `**/api/persons/*/${kind === 'triage' ? 'update-triage-color' : 'location'}`;
}
export async function queued(page: Page): Promise<any[]> {
  return page.evaluate(
    () =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open('ambulanzsystem-offline', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
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
export async function openEditor(page: Page, kind: Kind) {
  await page.goto(kind === 'body-part' ? '/body/front' : '/triage');
  await expect(
    page.getByRole('heading', {
      name: kind === 'body-part' ? 'Vorne' : 'Triage erfassen',
      exact: true,
    }),
  ).toBeVisible();
}
export async function edit(page: Page, kind: Kind, newer = false) {
  if (kind === 'triage') await page.getByLabel('Transport', { exact: true }).setChecked(!newer);
  else if (kind === 'body-part')
    await page.getByRole('button', { name: 'kopf', exact: true }).click();
  else {
    await page.getByLabel('Latitude', { exact: true }).fill(newer ? '48.3' : '48.2');
    await page.getByLabel('Longitude', { exact: true }).fill(newer ? '16.4' : '16.3');
    await page.getByRole('button', { name: 'Position speichern', exact: true }).click();
  }
}
export function answer(kind: Kind, body: any) {
  return kind === 'body-part'
    ? {
        idpatient: 7,
        bodyParts: { kopf_vorne: body.isClicked ? 1 : 0 },
        writeResult: {
          outcome: 'applied',
          conflictReason: null,
          bodyPartId: 'kopf_vorne',
          serverValue: body.isClicked ? 1 : 0,
        },
      }
    : {
        id: 7,
        operationSceneId: 1,
        transport: body.transport ?? false,
        latitudePatient: body.lat ?? null,
        longitudePatient: body.lng ?? null,
      };
}
export async function expectNewer(page: Page, kind: Kind) {
  if (kind === 'triage')
    await expect(page.getByLabel('Transport', { exact: true })).not.toBeChecked();
  else if (kind === 'body-part')
    await expect(page.getByRole('button', { name: 'kopf', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  else await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('48.3');
}
