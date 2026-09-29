import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = join(process.cwd(), 'dist', 'ambulanzsystem-frontend', 'browser');
const files = (await readdir(output))
  .filter((file) => /\.(?:css|js)$/.test(file) || file === 'favicon.ico')
  .map((file) => `/${file}`)
  .sort();

const manifest = `${JSON.stringify(files, null, 2)}\n`;
await writeFile(join(output, 'shell-manifest.json'), manifest);

// Hashed file names change with their content, so manifest + index.html identify the build.
const hash = createHash('sha256')
  .update(manifest)
  .update(await readFile(join(output, 'index.html')))
  .digest('hex')
  .slice(0, 16);
const workerPath = join(output, 'sw.js');
await writeFile(workerPath, (await readFile(workerPath, 'utf8')).replace('__BUILD_HASH__', hash));
