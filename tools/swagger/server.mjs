/**
 * Swagger UI over the API contract.
 *
 * Run:  npm run swagger          -> http://localhost:3830
 *       PORT=4000 npm run swagger
 *
 * It serves the contract straight from hualong-backend on every request, so a
 * reload shows the current file. Nothing is cached and nothing is copied.
 *
 * Two extras beyond a stock Swagger UI, both because this contract carries
 * `x-hualong-*` extensions that stock UI hides:
 *   /            the UI
 *   /roles       one HTML table of every operation with its allowed roles,
 *                its action_key and whatever GAP blocks it
 *   /openapi.yaml  the raw contract
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specPath, specText } from '../openapi-source.mjs';
import { indexPage, rolesPage, specForUi } from './pages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3830);

// swagger-ui-dist ships the browser bundle; resolving through import.meta
// avoids hard-coding node_modules, which a workspace hoist would move.
const UI_DIST = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/swagger-ui.css')));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.yaml': 'application/yaml; charset=utf-8',
};

const INDEX = indexPage({
  specUrl: '/openapi.local.yaml',
  rolesUrl: '/roles',
  rawUrl: '/openapi.yaml',
  note: 'Try-it-out 默认指向本地 mock <code>http://127.0.0.1:3820/api/v1</code>',
});

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  if (path === '/' || path === '/index.html') return send(200, MIME['.html'], INDEX);
  if (path === '/roles') return send(200, MIME['.html'], rolesPage({ homeUrl: '/', rawUrl: '/openapi.yaml' }));
  if (path === '/openapi.yaml') return send(200, MIME['.yaml'], specText());
  if (path === '/openapi.local.yaml') return send(200, MIME['.yaml'], specForUi());

  // Static assets from swagger-ui-dist. normalize() collapses `..` before the
  // join, so a traversal cannot escape the dist directory.
  const rel = normalize(path).replace(/^[/\\]+/, '');
  const file = join(UI_DIST, rel);
  if (!file.startsWith(UI_DIST) || !existsSync(file)) {
    return send(404, MIME['.html'], '<h1>404</h1>');
  }
  send(200, MIME[extname(file)] || 'application/octet-stream', readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Swagger UI      ->  http://localhost:${PORT}/`);
  console.log(`角色矩阵         ->  http://localhost:${PORT}/roles`);
  console.log(`契约文件         ->  ${specPath()}`);
});
