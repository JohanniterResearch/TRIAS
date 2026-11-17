import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { ApiClient } from '../../api/api-client';
import { OfflineQueueService } from '../../sync/offline-queue.service';
import { ResponderStateStore } from '../services/responder-state';
import { BodyMapPage } from './body-map-page';

describe('BodyMapPage durable intents', () => {
  let queue: any;
  let api: any;
  beforeEach(() => {
    queue = {
      queueBodyPart: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
      bodyPartPending: signal([]),
      bodyPartResults: signal([]),
    };
    api = {
      getBodyParts: vi.fn().mockReturnValue(of({ bodyParts: { kopf_vorne: 0 } })),
      toggleBodyPart: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: OfflineQueueService, useValue: queue },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
  });
  function page(): any {
    return TestBed.runInInjectionContext(() => new BodyMapPage());
  }
  function complete(writeId: string, value: number, rejected = false, superseded = false) {
    queue.bodyPartResults.set([
      {
        patientId: 7,
        sourcePatientId: 7,
        region: 'kopf_vorne',
        writeId,
        superseded,
        record: {
          bodyParts: { kopf_vorne: value },
          writeResult: {
            outcome: rejected ? 'rejected' : 'applied',
            conflictReason: rejected ? 'older_edit' : null,
            serverValue: value,
          },
        },
      },
    ]);
    TestBed.tick();
  }
  it('waits for the local commit before dispatch and captures click time and UUID once', async () => {
    let commit!: () => void;
    queue.queueBodyPart.mockReturnValue(
      new Promise<void>((resolve) => {
        commit = resolve;
      }),
    );
    const instance = page();
    instance.toggle('kopf_vorne');
    expect(queue.flush).not.toHaveBeenCalled();
    expect(api.toggleBodyPart).not.toHaveBeenCalled();
    const [id, body, key] = queue.queueBodyPart.mock.calls[0];
    expect(id).toBe(7);
    expect(body).toMatchObject({
      bodyPartId: 'kopf_vorne',
      isClicked: true,
      clientUpdatedAt: expect.any(String),
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    commit();
    await Promise.resolve();
    expect(queue.flush).toHaveBeenCalledWith(true);
  });
  it('reports aborted local storage and never starts the request', async () => {
    queue.queueBodyPart.mockRejectedValue(new Error('transaction aborted'));
    const instance = page();
    instance.toggle('kopf_vorne');
    await Promise.resolve();
    expect(queue.flush).not.toHaveBeenCalled();
    expect(instance.error()).toContain('nicht dauerhaft gespeichert');
  });
  it.each([0, 1])('shows the region and authoritative rejected value %i', (value) => {
    const instance = page();
    instance.toggle('kopf_vorne');
    complete(queue.queueBodyPart.mock.calls[0][2], value, true);
    expect(instance.isMarked('kopf_vorne')).toBe(value === 1);
    expect(instance.conflictMessages()[0]).toContain(
      'kopf (vorne): Deine Änderung wurde nicht übernommen',
    );
  });
  it('preserves a newer local region intent when an older rejection arrives', () => {
    const instance = page();
    instance.toggle('kopf_vorne');
    const first = queue.queueBodyPart.mock.calls[0][2];
    instance.toggle('kopf_vorne');
    const second = queue.queueBodyPart.mock.calls[1][2];
    expect(second).not.toBe(first);
    complete(first, 1, true, true);
    expect(instance.isMarked('kopf_vorne')).toBe(false);
    expect(instance.latestIntent.get('kopf_vorne').writeId).toBe(second);
    complete(second, 0);
    expect(instance.isMarked('kopf_vorne')).toBe(false);
  });
  it('does not reset a confirmed latest intent when the initial load arrives late', () => {
    const initial = new Subject<any>();
    api.getBodyParts.mockReturnValue(initial);
    const instance = page();
    instance.toggle('kopf_vorne');
    complete(queue.queueBodyPart.mock.calls[0][2], 1);
    initial.next({ bodyParts: { kopf_vorne: 0 } });
    expect(instance.isMarked('kopf_vorne')).toBe(true);
  });
});
