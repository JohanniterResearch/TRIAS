import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import { ApiClient, ApiRequestError } from '../../api/api-client';
import { AdminDashboard } from './admin-dashboard';

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

describe('AdminDashboard user creation errors', () => {
  it.each([
    [409, 'Username already exists.'],
    [500, 'Benutzer konnte nicht angelegt werden.'],
  ])('explains HTTP %s and allows retrying', (status, message) => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiClient,
          useValue: {
            createUser: () =>
              throwError(
                () =>
                  new ApiRequestError(
                    status,
                    status === 409 ? { message: 'Username already exists.' } : {},
                  ),
              ),
          },
        },
      ],
    });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    dashboard['createUser']();
    expect(dashboard['error']()).toBe(message);
    expect(dashboard['busy']()).toBe(false);
  });
});

describe('AdminDashboard event scene picker', () => {
  function setup(listScenes: () => ReturnType<ApiClient['listScenes']>) {
    TestBed.configureTestingModule({
      providers: [{ provide: ApiClient, useValue: { listScenes } }],
    });
    return TestBed.runInInjectionContext(() => new AdminDashboard());
  }

  it('fills the eventSceneId control when the datalist entry matches exactly', () => {
    const dashboard = setup(() => of([]));
    dashboard['selectEventScene'](inputEvent('Sommerfest 2026 (ID 3)'));
    expect(dashboard['userForm'].controls.eventSceneId.value).toBe(3);
  });

  it('leaves eventSceneId untouched while the typed text is only a partial match', () => {
    const dashboard = setup(() => of([]));
    dashboard['selectEventScene'](inputEvent('Sommerfest'));
    expect(dashboard['userForm'].controls.eventSceneId.value).toBeNull();
  });

  it('loads scenes on first focus and does not refetch once loaded', () => {
    const scenes = [{ id: 3, name: 'Sommerfest 2026', active: true }];
    const listScenes = vi.fn().mockReturnValue(of(scenes));
    const dashboard = setup(listScenes as unknown as () => ReturnType<ApiClient['listScenes']>);

    dashboard['ensureScenesLoaded']();
    expect(dashboard['scenes']()).toEqual(scenes as never);
    expect(listScenes).toHaveBeenCalledTimes(1);

    dashboard['ensureScenesLoaded']();
    expect(listScenes).toHaveBeenCalledTimes(1);
  });

  it('reports the load error and stays retryable', () => {
    const dashboard = setup(() => throwError(() => new ApiRequestError(500, {})));
    dashboard['ensureScenesLoaded']();
    expect(dashboard['error']()).toBe('Szenen konnten nicht geladen werden.');
    expect(dashboard['busy']()).toBe(false);
  });
});

describe('AdminDashboard disabled submit reasons', () => {
  it('requires an event scene before allowing an Event account to be created', () => {
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: {} }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());

    dashboard['userForm'].patchValue({
      username: 'responder-1',
      password: 'password1',
      accountType: 'event',
    });

    expect(dashboard['userForm'].invalid).toBe(true);
    expect(dashboard['userDisabledReason']()).toContain('Event-Szene-ID');

    dashboard['userForm'].controls.eventSceneId.setValue(3);
    expect(dashboard['userForm'].valid).toBe(true);
    expect(dashboard['userDisabledReason']()).toBe('');
  });

  it('names the missing responder QR event scene', () => {
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: {} }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    expect(dashboard['loginQrDisabledReason']()).toContain('Event-Szene-ID fehlt');
  });
});

describe('AdminDashboard management search', () => {
  it('passes all user dropdown filters to the API and opens results in the modal', () => {
    const adminUsers = vi.fn().mockReturnValue(of({ total: 0, items: [] }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { adminUsers } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());

    dashboard['userSearchForm'].setValue({
      search: 'anna',
      role: 'responder',
      accountType: 'event',
      status: 'active',
    });
    dashboard['searchManagedUsers']();

    expect(dashboard['userManagementOpen']()).toBe(true);
    expect(adminUsers).toHaveBeenCalledWith('anna', 'responder', 'event', 'active');
  });

  it('loads user autocomplete suggestions only after two characters', () => {
    const adminUsers = vi.fn().mockReturnValue(of({ total: 1, items: [{ id: 3, username: 'anna' }] }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { adminUsers } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());

    dashboard['suggestManagedUsers'](inputEvent('a'));
    expect(adminUsers).not.toHaveBeenCalled();

    dashboard['userSearchForm'].controls.search.setValue('an');
    dashboard['suggestManagedUsers'](inputEvent('an'));
    expect(dashboard['managedUserSuggestions']()).toEqual([{ id: 3, username: 'anna' }]);
  });

  it('allows a numeric patient ID to request autocomplete suggestions', () => {
    const adminPatients = vi
      .fn()
      .mockReturnValue(of({ total: 1, items: [{ editReference: 'opaque', humanReadableId: 'P-1' }] }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { adminPatients } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());

    dashboard['patientSearchForm'].controls.search.setValue('1');
    dashboard['suggestManagedPatients'](inputEvent('1'));

    expect(adminPatients).toHaveBeenCalledWith('1', undefined, undefined);
    expect(dashboard['managedPatientSuggestions']()).toEqual([
      { editReference: 'opaque', humanReadableId: 'P-1' },
    ]);
  });

  it('populates the patient-search scene dropdown on focus', () => {
    const listScenes = vi.fn().mockReturnValue(of([{ id: 3, name: 'Sommerfest', active: true }]));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { listScenes } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());

    dashboard['ensureScenesLoaded']();

    expect(dashboard['scenes']()).toEqual([{ id: 3, name: 'Sommerfest', active: true }]);
  });

  it('loads detailed patient corrections only through the opaque edit reference', () => {
    const adminPatientDetails = vi.fn().mockReturnValue(
      of({
        patient: { editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' },
        bodyParts: { kopf_vorne: 0 },
        protocol: { status: 'draft', formState: {}, updatedAt: '' },
        qrCodeBound: false,
        auditEntries: [],
      }),
    );
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { adminPatientDetails, availableAdminPatientQrCodes: () => of({ total: 0, items: [] }) } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    dashboard['selectManagedPatient']({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' });

    dashboard['openManagedPatientDetails']();

    expect(adminPatientDetails).toHaveBeenCalledWith('opaque');
    expect(dashboard['managedPatientDetails']()?.bodyParts).toEqual({ kopf_vorne: 0 });
  });
});

describe('AdminDashboard detailed patient display', () => {
  it('saves the yes/no stammdaten as checkbox booleans', () => {
    const updateAdminPatient = vi.fn().mockReturnValue(of({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { updateAdminPatient } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    dashboard['selectManagedPatient']({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '', atmung: true, blutung: false });
    dashboard['managedPatientForm'].controls.atmung.markAsDirty();
    dashboard['managedPatientForm'].controls.blutung.markAsDirty();

    dashboard['saveManagedPatient']();

    expect(updateAdminPatient).toHaveBeenCalledWith('opaque', expect.objectContaining({ atmung: true, blutung: false }));
  });

  it('does not overwrite unknown yes/no values when another correction is saved', () => {
    const updateAdminPatient = vi.fn().mockReturnValue(of({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { updateAdminPatient } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    dashboard['selectManagedPatient']({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '', atmung: null });

    dashboard['saveManagedPatient']();

    expect(updateAdminPatient).toHaveBeenCalledWith('opaque', expect.not.objectContaining({ atmung: expect.anything() }));
  });

  it('renders only populated protocol values in the read-only summary', () => {
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: {} }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    const sections = dashboard['protocolSections']({
      status: 'finalized',
      updatedAt: '',
      finalizedAt: '2026-09-17T10:00:00Z',
      formState: { patient: { vorname: 'Lea', telefon: '' }, vitals: { puls: '80', keine: false } },
    } as never);

    expect(sections.find((section) => section.title === 'Patientendaten')?.entries).toEqual([
      { label: 'patient · vorname', value: 'Lea' },
    ]);
    expect(sections.find((section) => section.title === 'Vitalwerte')?.entries).toEqual([
      { label: 'vitals · puls', value: '80' },
    ]);
    expect(sections.find((section) => section.title === 'Abschluss')?.entries[0]).toEqual({
      label: 'Status', value: 'Finalisiert',
    });
  });

  it('uses a selected opaque QR reference and never a text token', () => {
    const assignAdminPatientQrCode = vi.fn().mockReturnValue(of({
      patient: { editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' },
      printableQrToken: null,
    }));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: { assignAdminPatientQrCode, availableAdminPatientQrCodes: () => of({ total: 0, items: [] }) } }] });
    const dashboard = TestBed.runInInjectionContext(() => new AdminDashboard());
    dashboard['managedPatient'].set({ editReference: 'opaque', operationSceneId: 3, protocolStatus: 'draft', createdAt: '', updatedAt: '' });
    dashboard['managedQrForm'].controls.qrReference.setValue('opaque-qr');

    dashboard['assignManagedPatientQr']('existing');

    expect(assignAdminPatientQrCode).toHaveBeenCalledWith('opaque', { source: 'existing', qrReference: 'opaque-qr' });
  });
});
