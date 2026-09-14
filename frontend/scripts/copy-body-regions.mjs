import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, '../../contract/body-regions.json');
const target = join(root, '../public/body-regions.json');

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
