import { computed, Injectable, signal } from '@angular/core';

import type { components } from '../../api/openapi-types';

type OperationScene = components['schemas']['OperationScene'];
type Patient = components['schemas']['Patient'];

interface ResponderState {
  scene: OperationScene | null;
  patient: Patient | null;
}

const storageKey = 'ambulanzsystem.responder.v1';
const emptyState: ResponderState = { scene: null, patient: null };

@Injectable({ providedIn: 'root' })
export class ResponderStateStore {
  private readonly state = signal<ResponderState>(this.load());

  readonly scene = computed(() => this.state().scene);
  readonly patient = computed(() => this.state().patient);

  setScene(scene: OperationScene): void {
    this.save({ ...this.state(), scene });
  }

  setPatient(patient: Patient): void {
    this.save({ ...this.state(), patient });
  }

  replacePatient(provisionalId: number, patient: Patient): void {
    if (this.state().patient?.id === provisionalId) {
      this.setPatient(patient);
    }
  }

  clearPatient(): void {
    this.save({ ...this.state(), patient: null });
  }

  clear(): void {
    this.state.set(emptyState);
    localStorage.removeItem(storageKey);
  }

  private save(state: ResponderState): void {
    this.state.set(state);
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  private load(): ResponderState {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return emptyState;
    }

    try {
      return { ...emptyState, ...JSON.parse(raw) };
    } catch {
      localStorage.removeItem(storageKey);
      return emptyState;
    }
  }
}
