import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');

// Invariant: after migration, files in src/ must use ES-module syntax only — no
// CommonJS require()/module.exports/exports.* left behind. Any CommonJS interop
// shim lives outside src/ (e.g. a root-level .cjs entry or an exports map), so
// this check is scoped to src/. Fails while src/ is still CommonJS.
for (const file of readdirSync(srcDir)) {
  if (!/\.(js|mjs|cjs)$/.test(file)) continue;
  const text = readFileSync(join(srcDir, file), 'utf8');
  assert.ok(!/\brequire\s*\(/.test(text), `require() found in src/${file} — migrate to import`);
  assert.ok(!/module\.exports\b/.test(text), `module.exports found in src/${file} — migrate to export`);
  assert.ok(!/\bexports\.[A-Za-z_$]/.test(text), `exports.* found in src/${file} — migrate to export`);
}

// Behavior must survive the migration. Dynamic import works for both a CommonJS
// module (values arrive under `default`) and an ES module (named exports).
const mod = await import(pathToFileURL(join(srcDir, 'calc.js')).href);
const calc = typeof mod.add === 'function' ? mod : mod.default;
assert.strictEqual(calc.add(2, 3), 5);
assert.strictEqual(calc.multiply(4, 5), 20);

console.log('esm migration tests passed');
