import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const mode = process.argv[2];
if (!['applications', 'current'].includes(mode)) {
  console.error('Usage: node scripts/switch-home.mjs applications|current');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const source = new URL(`home-${mode}.html`, root);
const html = await readFile(source, 'utf8');
await writeFile(new URL('index.html', root), html);
console.log(`Homepage switched to ${mode} using ${fileURLToPath(source)}.`);
