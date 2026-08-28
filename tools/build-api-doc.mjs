/**
 * Writes the contract viewer out as static files, for GitHub Pages.
 *
 * Run:  node tools/build-api-doc.mjs <outdir>     (default: dist/api-doc)
 *
 * The local viewer (`npm run swagger`) reads the contract on every request and
 * copies nothing — that is the right shape for a machine that has the backend
 * repo mounted. Pages has no such machine and no Node process, so the site is
 * generated: this script is the only place a copy of `openapi.yaml` is ever
 * made, and it makes it at publish time so the copy cannot outlive the build.
 *
 * A stale copy is worse than none (`tools/openapi-source.mjs`), so nothing this
 * script writes is committed. `dist/` is ignored; CI builds and uploads it.
 *
 * Try-it-out still works from the published site, but only against a mock the
 * reader runs themselves: `npm run mock` on port 3820. Browsers exempt
 * `127.0.0.1` from mixed-content blocking and the mock already sends
 * `access-control-allow-origin: *`, so an https:// page can reach it.
 */

import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specPath, specText } from './openapi-source.mjs';
import { indexPage, rolesPage, specForUi } from './swagger/pages.mjs';

const UI_DIST = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/swagger-ui.css')));

// Only what the two pages load. swagger-ui-dist also ships an es-bundle, a
// standalone HTML and source maps; shipping those triples the artifact for
// nothing.
const ASSETS = ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js'];

const NOTE = 'Try-it-out 需要本地跑 <code>npm run mock</code>（127.0.0.1:3820），本站没有后端';

const out = resolve(process.argv[2] || 'dist/api-doc');
mkdirSync(out, { recursive: true });

writeFileSync(join(out, 'index.html'), indexPage({
  specUrl: './openapi.local.yaml',
  rolesUrl: './roles.html',
  rawUrl: './openapi.yaml',
  note: NOTE,
}));
writeFileSync(join(out, 'roles.html'), rolesPage({
  homeUrl: './index.html',
  rawUrl: './openapi.yaml',
}));
writeFileSync(join(out, 'openapi.yaml'), specText());
writeFileSync(join(out, 'openapi.local.yaml'), specForUi());

for (const a of ASSETS) {
  const from = join(UI_DIST, a);
  if (!existsSync(from)) throw new Error(`swagger-ui-dist 缺 ${a}：${from}`);
  copyFileSync(from, join(out, a));
}

console.log(`契约   ${specPath()}`);
console.log(`站点   ${out}`);
console.log(`文件   ${['index.html', 'roles.html', 'openapi.yaml', 'openapi.local.yaml', ...ASSETS].join(', ')}`);
