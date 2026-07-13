import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = join(process.cwd(), 'dist', 'ambulanzsystem-frontend', 'browser');
const files = (await readdir(output))
  .filter((file) => /\.(?:css|js)$/.test(file) || file === 'favicon.ico')
  .map((file) => `/${file}`)
  .sort();

await writeFile(join(output, 'shell-manifest.json'), `${JSON.stringify(files, null, 2)}\n`);
