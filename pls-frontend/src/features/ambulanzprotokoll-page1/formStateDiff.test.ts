import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changedLeaves, isEmptyLeaf, leafPaths } from './formStateDiff';
import { createPage1Template } from './page1State';

const { put } = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  default: { put },
}));

import { putPage1 } from './page1Api';

describe('changedLeaves (security review 3, M2)', () => {
  it('returns only the leaves that differ, arrays compared whole', () => {
    const base = { a: { b: 'x', c: [1, 2] }, d: null };
    expect(changedLeaves({ a: { b: 'x', c: [1, 3] }, d: null }, base)).toEqual({ a: { c: [1, 3] } });
    expect(changedLeaves({ a: { b: '', c: [1, 2] }, d: 5 }, base)).toEqual({ a: { b: '' }, d: 5 });
    expect(changedLeaves(base, base)).toEqual({});
  });

  it('lists leaf paths and uses the server emptiness rule', () => {
    expect(leafPaths({ a: { b: 1, c: { d: [] } } })).toEqual(['a.b', 'a.c.d']);
    expect([null, '  ', []].every(isEmptyLeaf)).toBe(true);
    expect([0, false, 'x', [1]].some(isEmptyLeaf)).toBe(false);
  });
});

describe('putPage1 with a base version', () => {
  beforeEach(() => {
    put.mockReset();
    put.mockResolvedValue({ data: { patientId: 7, status: 'finalized', updatedAt: '2026-01-01T00:00:00Z', formState: {} } });
  });

  it('sends only the changed leaves, in server vocabulary', async () => {
    const base = createPage1Template();
    const next = { ...base, incident: { ...base.incident, ambulanzort: 'Korrigiert' } };
    await putPage1(7, { formState: next, baseFormState: base, status: 'finalized', correctionReason: 'r' });
    const body = put.mock.calls[0][1];
    expect(body.formState).toEqual({ incident: { ambulanzort: 'Korrigiert' } });
    expect(body).not.toHaveProperty('baseFormState');
  });

  it('sends the whole state without a base (drafts)', async () => {
    const state = createPage1Template();
    await putPage1(7, { formState: state, status: 'draft' });
    expect(leafPaths(put.mock.calls[0][1].formState)).toHaveLength(79);
  });
});
