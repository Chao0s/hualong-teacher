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
import { specPath, specText, operations, loadSpec } from '../openapi-source.mjs';

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

const INDEX = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API 契约 · Swagger UI</title>
<link rel="stylesheet" href="./swagger-ui.css">
<style>
  body { margin: 0; }
  .hl-bar { background: #1f2937; color: #f9fafb; padding: 10px 16px;
            font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .hl-bar a { color: #93c5fd; margin-left: 16px; }
  .hl-bar code { color: #fcd34d; }
</style>
</head>
<body>
<div class="hl-bar">
  化龙幼儿园三端共用后端 API 契约 &mdash; 只读视图，源文件在 <code>hualong-backend/api/openapi.yaml</code>
  <a href="/roles">按角色查看（x-hualong-roles）</a>
  <a href="/openapi.yaml">原始 YAML</a>
</div>
<div id="swagger-ui"></div>
<script src="./swagger-ui-bundle.js"></script>
<script src="./swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: '/openapi.yaml',
  dom_id: '#swagger-ui',
  deepLinking: true,
  docExpansion: 'none',
  defaultModelsExpandDepth: 0,
  tryItOutEnabled: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
  layout: 'StandaloneLayout',
});
</script>
</body>
</html>
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

/** The view stock Swagger UI cannot give: authorization at a glance. */
function rolesPage() {
  const rows = operations(loadSpec());
  const cells = rows.map((r) => `<tr class="${r.roles.includes('teacher') ? 'teacher' : ''}">
      <td class="m m-${r.method}">${r.method}</td>
      <td><code>${escapeHtml(r.path)}</code></td>
      <td>${r.isPublic ? '<em>登录前公开</em>' : escapeHtml(r.roles.join(', ')) || '<b class="bad">无</b>'}</td>
      <td>${escapeHtml(r.actions.join('<br>')) || '&mdash;'}</td>
      <td>${escapeHtml(r.successCodes.join(', ')) || '&mdash;'}</td>
      <td>${r.blockedOn.length ? `<b class="bad">${escapeHtml(r.blockedOn.join('; '))}</b>` : '&mdash;'}</td>
    </tr>`).join('\n');

  const teacherCount = rows.filter((r) => r.roles.includes('teacher')).length;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>化龙 API · 角色矩阵</title>
<style>
 body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 0 0 40px; }
 .hl-bar { background:#1f2937; color:#f9fafb; padding:10px 16px; }
 .hl-bar a { color:#93c5fd; margin-left:16px; }
 table { border-collapse: collapse; width: 100%; }
 th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; vertical-align: top; }
 th { position: sticky; top: 0; background: #f3f4f6; }
 tr.teacher { background: #f0f9ff; }
 .m { font-weight: 700; white-space: nowrap; }
 .m-GET { color:#047857 } .m-POST { color:#1d4ed8 } .m-PUT { color:#b45309 }
 .m-PATCH { color:#7c3aed } .m-DELETE { color:#b91c1c }
 .bad { color:#b91c1c }
 code { font: 13px/1.4 ui-monospace, Consolas, monospace; }
 .sum { padding: 10px 16px; background:#fffbeb; }
</style></head><body>
<div class="hl-bar">化龙 API · 角色矩阵<a href="/">回到 Swagger UI</a><a href="/openapi.yaml">原始 YAML</a></div>
<div class="sum">共 <b>${rows.length}</b> 个操作，其中教师端可达 <b>${teacherCount}</b> 个（浅蓝行）。
越权回 <b>404</b> 不回 403（契约 §7.2）；401 只用于无会话与会话失效。</div>
<table><thead><tr>
<th>方法</th><th>路径</th><th>x-hualong-roles</th><th>action_key</th><th>成功码</th><th>阻断</th>
</tr></thead><tbody>
${cells}
</tbody></table></body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  if (path === '/' || path === '/index.html') return send(200, MIME['.html'], INDEX);
  if (path === '/roles') return send(200, MIME['.html'], rolesPage());
  if (path === '/openapi.yaml') return send(200, MIME['.yaml'], specText());

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
