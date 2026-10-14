// Leaf-level diff of protocol form states, with the server's notion of a leaf (FormStateMerge.cs):
// a scalar, null or array; objects are descended into. Used so a correction sends only what the
// user changed (security review 3, M2): untouched leaves would otherwise be re-stamped with the
// correction's time and win over a concurrent correction of the same field.

type Tree = Record<string, unknown>;

const isObject = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The leaves of `next` that differ from `base`, as a partial tree (empty object when none). */
export function changedLeaves(next: Tree, base: Tree): Tree {
  const result: Tree = {};
  for (const [key, value] of Object.entries(next)) {
    if (isObject(value)) {
      const nested = changedLeaves(value, isObject(base[key]) ? base[key] : {});
      if (Object.keys(nested).length) result[key] = nested;
    } else if (JSON.stringify(value ?? null) !== JSON.stringify(base[key] ?? null)) {
      result[key] = value;
    }
  }
  return result;
}

/** Same emptiness rule as the server merge: null, blank string, empty array. */
export function isEmptyLeaf(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
}

/** Dotted paths of the leaves in a partial tree. */
export function leafPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    isObject(value) ? leafPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

export function leafAt(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), tree);
}
