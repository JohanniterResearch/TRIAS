import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiClient } from '../../api/api-client';
import { AuthStore } from '../../auth/auth.store';
import { ResponderStateStore } from '../services/responder-state';
import { PatientChoicePage } from './patient-choice-page';

describe('PatientChoicePage copy badge', () => {
  const patient = signal<any>(null);
  const api = {
    reassignPatientQrCode: vi.fn(() => of({})),
  };
  const auth = {
    activeSession: vi.fn(() => ({ tokenType: 'user', username: 'san-1' })),
  };

  beforeEach(() => {
    patient.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: AuthStore, useValue: auth },
        {
          provide: ResponderStateStore,
          useValue: { patient, setPatient: (p: any) => patient.set(p) },
        },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => '42' } } },
        },
      ],
    });
  });

  it('renders copy badge and reference to original patient when copiedFromPatientId is set', () => {
    patient.set({
      id: 42,
      humanReadableId: 'P-42',
      copiedFromPatientId: 10,
    });
    const fixture = TestBed.createComponent(PatientChoicePage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.copy-badge')?.textContent).toContain('Kopie');
    expect(el.querySelector('.copy-notice')?.textContent).toContain('10');
  });

  it('does not render copy badge when patient is original', () => {
    patient.set({
      id: 42,
      humanReadableId: 'P-42',
      copiedFromPatientId: null,
    });
    const fixture = TestBed.createComponent(PatientChoicePage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.copy-badge')).toBeNull();
    expect(el.querySelector('.copy-notice')).toBeNull();
  });
});
