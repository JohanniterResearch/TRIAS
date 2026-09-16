import { TestBed } from '@angular/core/testing';
import { FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../../auth/auth.store';
import { ResponderStateStore } from '../../responder/services/responder-state';
import { SceneRealtimeEvent, SceneRealtimeService } from '../services/scene-realtime.service';
import { SituationRoomPage } from './situation-room-page';

describe('SituationRoomPage scene ownership', () => {
  let patientResponses: Map<number, Subject<any[]>>;
  let realtime: Subject<SceneRealtimeEvent>;
  let page: SituationRoomPage;
  let api: any;
  let realtimeService: any;
  const auth = {
    activeSession: vi.fn(() => ({ tokenType: 'user' })),
    eventSceneId: vi.fn<() => number | null>(() => null),
  };
  const responder = {
    scene: () => null,
    patient: () => ({ id: 1 }),
    setPatient: vi.fn(),
    clearPatient: vi.fn(),
  };

  beforeEach(() => {
    history.replaceState({}, '');
    auth.activeSession.mockReset();
    auth.activeSession.mockReturnValue({ tokenType: 'user' });
    auth.eventSceneId.mockReset();
    auth.eventSceneId.mockReturnValue(null);
    patientResponses = new Map([
      [1, new Subject()],
      [2, new Subject()],
    ]);
    realtime = new Subject();
    api = {
      listPatients: (id: number) => patientResponses.get(id)!,
      listTeams: () => of([]),
      listScenes: vi.fn(() => of([])),
    };
    realtimeService = { connect: vi.fn(() => realtime), disconnect: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        { provide: ApiClient, useValue: api },
        { provide: AuthStore, useValue: auth },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: SceneRealtimeService, useValue: realtimeService },
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

  it('opens the only accessible Leitstelle event automatically', () => {
    auth.activeSession.mockReturnValue({ tokenType: 'leitstelle' });
    auth.eventSceneId.mockReturnValue(1);
    api.listScenes.mockReturnValue(of([scene(1, 'Hauptbahnhof'), scene(2, 'Nordtor', 1)]));

    (page as any).loadAccessibleScenes();

    expect((page as any).sceneForm.controls.sceneId.value).toBe(1);
    expect(realtimeService.connect).toHaveBeenCalledWith(1);
  });

  it('opens a named scene selected by a Leitstelle with multiple accessible scenes', () => {
    auth.activeSession.mockReturnValue({ tokenType: 'leitstelle' });
    api.listScenes.mockReturnValue(of([scene(1, 'Hauptbahnhof'), scene(2, 'Prater')]));

    (page as any).loadAccessibleScenes();
    (page as any).selectAccessibleScene({ target: { value: 'Prater (ID 2)' } });
    (page as any).setScene();

    expect((page as any).sceneForm.controls.sceneId.value).toBe(2);
    expect(realtimeService.connect).toHaveBeenCalledTimes(1);
    expect(realtimeService.connect).toHaveBeenCalledWith(2);
  });

  it('lets a permanent Leitstelle select an event by its ID', () => {
    auth.activeSession.mockReturnValue({ tokenType: 'leitstelle' });
    auth.eventSceneId.mockReturnValue(null);
    api.listScenes.mockReturnValue(of([scene(1, 'Hauptbahnhof')]));

    (page as any).loadAccessibleScenes();
    (page as any).selectAccessibleScene({ target: { value: '1' } });
    (page as any).setScene();

    expect((page as any).sceneForm.controls.sceneId.value).toBe(1);
    expect(realtimeService.connect).toHaveBeenCalledTimes(1);
  });

  it('lets an event-scoped Leitstelle retry a failed scene load', () => {
    auth.activeSession.mockReturnValue({ tokenType: 'leitstelle' });
    auth.eventSceneId.mockReturnValue(1);
    api.listScenes.mockReturnValueOnce(throwError(() => new Error('offline')));

    (page as any).loadAccessibleScenes();

    expect((page as any).sceneLoadFailed()).toBe(true);
    api.listScenes.mockReturnValue(of([scene(1, 'Hauptbahnhof')]));
    (page as any).loadAccessibleScenes();

    expect((page as any).sceneLoadFailed()).toBe(false);
    expect(realtimeService.connect).toHaveBeenCalledWith(1);
  });

  it('does not open a scene that was not returned for the Leitstelle', () => {
    auth.activeSession.mockReturnValue({ tokenType: 'leitstelle' });
    api.listScenes.mockReturnValue(of([scene(1, 'Hauptbahnhof'), scene(2, 'Prater')]));

    (page as any).loadAccessibleScenes();
    (page as any).selectAccessibleScene({ target: { value: 'Fremd (ID 3)' } });

    expect((page as any).sceneForm.controls.sceneId.value).toBeNull();
    expect(realtimeService.connect).not.toHaveBeenCalled();
  });
});

function patient(id: number): any {
  return { id, humanReadableId: String(id), createdAt: '', updatedAt: '' };
}

function scene(id: number, name: string, parentSceneId?: number): any {
  return { id, name, parentSceneId };
}
