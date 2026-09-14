import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { ResponderStateStore } from '../services/responder-state';
import { BodyMapPage } from './body-map-page';

describe('BodyMapPage intent ordering', () => {
  it('reconciles an ambiguous failed toggle without letting the initial load overwrite it', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const initialLoad = new Subject<any>();
    const reconciliationLoad = new Subject<any>();
    const toggle = new Subject<any>();
    const api = {
      getBodyParts: vi
        .fn()
        .mockReturnValueOnce(initialLoad)
        .mockReturnValueOnce(reconciliationLoad),
      toggleBodyPart: vi.fn().mockReturnValue(toggle),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    initialLoad.next({ bodyParts: { kopf_vorne: 0 } });
    (page as any).toggle('kopf_vorne');
    toggle.error(new Error('response lost after server update'));
    reconciliationLoad.next({ bodyParts: { kopf_vorne: 1 } });
    initialLoad.next({ bodyParts: { kopf_vorne: 0 } });

    expect(api.getBodyParts).toHaveBeenCalledTimes(2);
    expect((page as any).isMarked('kopf_vorne')).toBe(true);
  });

  it('keeps the final marked state when the initial load resolves after rapid writes', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const initialLoad = new Subject<any>();
    const first = new Subject<any>();
    const second = new Subject<any>();
    const third = new Subject<any>();
    const api = {
      getBodyParts: () => initialLoad,
      toggleBodyPart: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second)
        .mockReturnValueOnce(third),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');
    first.next({ bodyParts: { kopf_vorne: 1 } });
    first.complete();
    second.next({ bodyParts: { kopf_vorne: 0 } });
    second.complete();
    third.next({ bodyParts: { kopf_vorne: 1 } });
    third.complete();
    initialLoad.next({ bodyParts: { kopf_vorne: 0 } });

    expect((page as any).isMarked('kopf_vorne')).toBe(true);
  });

  it('returns to the confirmed unmarked state when both rapid toggles fail', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const first = new Subject<any>();
    const second = new Subject<any>();
    const api = {
      getBodyParts: () => of({ bodyParts: { kopf_vorne: 0 } }),
      toggleBodyPart: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');
    first.error(new Error('first failed'));
    second.error(new Error('second failed'));

    expect((page as any).isMarked('kopf_vorne')).toBe(false);
  });

  it('keeps the final intent when rapid responses would otherwise arrive reversed', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const first = new Subject<any>();
    const second = new Subject<any>();
    const api = {
      getBodyParts: () => of({ bodyParts: { kopf_vorne: 0 } }),
      toggleBodyPart: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');

    expect(api.toggleBodyPart).toHaveBeenCalledOnce();
    first.next({ bodyParts: { kopf_vorne: 1 } });
    first.complete();
    expect(api.toggleBodyPart).toHaveBeenCalledTimes(2);
    second.next({ bodyParts: { kopf_vorne: 0 } });

    expect((page as any).isMarked('kopf_vorne')).toBe(false);
  });

  it('uses the second server response when the first toggle fails', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const first = new Subject<any>();
    const second = new Subject<any>();
    const api = {
      getBodyParts: () => of({ bodyParts: { kopf_vorne: 0 } }),
      toggleBodyPart: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');
    first.error(new Error('first failed'));
    second.next({ bodyParts: { kopf_vorne: 0 } });

    expect((page as any).isMarked('kopf_vorne')).toBe(false);
  });

  it('returns to the first successful server response when the second toggle fails', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ json: () => Promise.resolve({ front: ['kopf_vorne'], back: [] }) }),
      ),
    );
    const first = new Subject<any>();
    const second = new Subject<any>();
    const api = {
      getBodyParts: vi
        .fn()
        .mockReturnValueOnce(of({ bodyParts: { kopf_vorne: 0 } }))
        .mockReturnValueOnce(of({ bodyParts: { kopf_vorne: 1 } })),
      toggleBodyPart: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ResponderStateStore, useValue: { patient: () => ({ id: 7 }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { routeConfig: { path: 'body/front' } } },
        },
      ],
    });
    const page = TestBed.runInInjectionContext(() => new BodyMapPage());

    (page as any).toggle('kopf_vorne');
    (page as any).toggle('kopf_vorne');
    first.next({ bodyParts: { kopf_vorne: 1 } });
    first.complete();
    second.error(new Error('second failed'));

    expect((page as any).isMarked('kopf_vorne')).toBe(true);
  });
});
