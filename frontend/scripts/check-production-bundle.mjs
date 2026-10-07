import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const browserDir = join(import.meta.dirname, '../dist/ambulanzsystem-frontend/browser');
const javascript = readdirSync(browserDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(join(browserDir, file), 'utf8'))
  .join('\n');

assert.doesNotMatch(javascript, /DEV (Admin|Responder)/);
assert.doesNotMatch(javascript, /localhost:4010|localhost:5042/);

const worker = readFileSync(join(browserDir, 'sw.js'), 'utf8');
assert.doesNotMatch(worker, /__BUILD_HASH__/, 'sw.js cache name was not versioned by postbuild');

console.log('production bundle contains no DEV controls or localhost API URLs');
