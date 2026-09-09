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
