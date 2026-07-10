import { Injectable } from '@angular/core';

const key = 'ambulanzsystem.triage-drafts.v1';

@Injectable({ providedIn: 'root' })
export class TriageDraftStore {
  get(patientId: number): Record<string, unknown> {
    return this.all()[patientId] ?? {};
  }

  merge(patientId: number, value: Record<string, unknown>): void {
    const all = this.all();
    all[patientId] = { ...all[patientId], ...value, clientUpdatedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(all));
  }

  private all(): Record<number, Record<string, unknown>> {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      localStorage.removeItem(key);
      return {};
    }
  }
}
