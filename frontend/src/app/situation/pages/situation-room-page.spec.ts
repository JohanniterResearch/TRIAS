import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, of } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { SceneRealtimeEvent, SceneRealtimeService } from '../services/scene-realtime.service';
import { SituationRoomPage } from './situation-room-page';

describe('SituationRoomPage scene ownership', () => {
  let patientResponses: Map<number, Subject<any[]>>;
  let realtime: Subject<SceneRealtimeEvent>;
  let page: SituationRoomPage;
  const responder = {
    scene: () => null,
    patient: () => ({ id: 1 }),
    setPatient: vi.fn(),
    clearPatient: vi.fn(),
  };

  beforeEach(() => {
    history.replaceState({}, '');
    patientResponses = new Map([
      [1, new Subject()],
      [2, new Subject()],
    ]);
    realtime = new Subject();
    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        {
          provide: ApiClient,
          useValue: {
            listPatients: (id: number) => patientResponses.get(id)!,
            listTeams: () => of([]),
          },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        {
          provide: SceneRealtimeService,
          useValue: { connect: () => realtime, disconnect: vi.fn() },
        },
        { provide: ResponderStateStore, useValue: responder },
      ],
    });
    page = TestBed.runInInjectionContext(() => new SituationRoomPage());
  });

  it('does not apply a delayed response from the previous scene', () => {
    (page as any).sceneForm.controls.sceneId.setValue(1);
    (page as any).connect();
    (page as any).sceneForm.controls.sceneId.setValue(2);
    (page as any).connect();

    patientResponses.get(2)!.next([patient(2)]);
    patientResponses.get(1)!.next([patient(1)]);

    expect((page as any).patients().map((item: any) => item.id)).toEqual([2]);
  });

  it('prunes patients and selection from an authoritative ScenePatientList', () => {
    (page as any).sceneForm.controls.sceneId.setValue(1);
    (page as any).connect();
    const removed = patient(1);
    const kept = patient(2);
    (page as any).patients.set([removed, kept]);
    (page as any).selectedPatient.set(removed);

    realtime.next({
      type: 'patient-list',
      payload: {
        sceneId: 1,
        patientIds: [2],
        eventTimestamp: '2026-01-01T10:00:00Z',
      },
    });

    expect((page as any).patients().map((item: any) => item.id)).toEqual([2]);
    expect((page as any).selectedPatient()).toBeNull();
    expect(responder.clearPatient).toHaveBeenCalledOnce();
  });

  it('refreshes when an authoritative patient list contains an unknown patient', () => {
    (page as any).sceneForm.controls.sceneId.setValue(1);
    (page as any).connect();

    realtime.next({
      type: 'patient-list',
      payload: { sceneId: 1, patientIds: [3], eventTimestamp: '2026-01-01T10:00:00Z' },
    });
    patientResponses.get(1)!.next([patient(3)]);

    expect((page as any).patients().map((item: any) => item.id)).toEqual([3]);
  });

  it('does not let a delayed same-scene response overwrite realtime state', () => {
    (page as any).sceneForm.controls.sceneId.setValue(1);
    (page as any).connect();

    realtime.next({
      type: 'patient',
      payload: { sceneId: 1, patient: patient(2), eventTimestamp: '2026-01-01T10:00:00Z' },
    });
    patientResponses.get(1)!.next([patient(1)]);

    expect((page as any).patients().map((item: any) => item.id)).toEqual([2]);
  });
});

function patient(id: number): any {
  return { id, humanReadableId: String(id), createdAt: '', updatedAt: '' };
}
