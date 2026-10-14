// Live-region checks for the PLS client (PLS parity plan WP 7.4), the counterpart of
// frontend/scripts/check-live-regions.mjs: every error message is announced (role="alert"),
// every success message politely (role="status"), and the document language is German.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
  });

// Opening JSX tags of HTML elements; `=>` inside an attribute does not end the tag.
const tags = (source) => [...source.matchAll(/<([a-z][a-z0-9]*)\b((?:=>|[^>])*)>/g)].map((m) => m[2]);

const failures = [];
let checked = 0;
for (const file of files(join(root, 'src'))) {
  for (const attrs of tags(readFileSync(file, 'utf8'))) {
    const className = attrs.match(/className="([^"]*)"/)?.[1] ?? '';
    const isError = /(^|[\s-])error\b/.test(className) || /color:\s*'red'/.test(attrs);
    const isSuccess = /\bmsg-success\b/.test(className);
    if (!isError && !isSuccess) continue;
    checked++;
    const role = attrs.match(/role="([^"]*)"/)?.[1];
    if (isError && role !== 'alert') failures.push(`${file.slice(root.length)}: error message without role="alert": <…${attrs.trim()}>`);
    if (isSuccess && role !== 'status' && role !== 'alert') failures.push(`${file.slice(root.length)}: success message without role="status": <…${attrs.trim()}>`);
  }
}

assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
assert.ok(checked > 20, `only ${checked} messages found; the pattern no longer matches the source`);
assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /<html lang="de">/, 'index.html must declare lang="de"');
console.log(`Live-region accessibility checks passed (${checked} messages).`);
