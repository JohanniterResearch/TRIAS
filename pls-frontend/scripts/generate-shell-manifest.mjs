// After `vite build` (parity plan WP 6.2): lists the files the service worker caches as the app
// shell and stamps the worker with a hash of the build, as the Ambulanzsystem client does.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const output = join(import.meta.dirname, '..', 'dist');
const skip = new Set(['index.html', 'sw.js', 'shell-manifest.json']);

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)])));
  return nested.flat();
}

const shell = (await files(output))
  .map((file) => relative(output, file).split(sep).join('/'))
  .filter((file) => !skip.has(file))
  .map((file) => `/${file}`)
  .sort();

const manifest = `${JSON.stringify(['/', ...shell], null, 2)}\n`;
await writeFile(join(output, 'shell-manifest.json'), manifest);

// The contents of every shell file, so a changed unhashed public file (icon, favicon) also
// yields a new worker and cache (final review L4).
const hashing = createHash('sha256').update(manifest);
for (const file of ['index.html', ...shell.map((path) => path.slice(1))].sort()) hashing.update(file).update(await readFile(join(output, file)));
const hash = hashing.digest('hex').slice(0, 16);
const workerPath = join(output, 'sw.js');
const worker = await readFile(workerPath, 'utf8');
if (!worker.includes('__BUILD_HASH__')) throw new Error('sw.js: build hash placeholder missing');
await writeFile(workerPath, worker.replace('__BUILD_HASH__', hash));
