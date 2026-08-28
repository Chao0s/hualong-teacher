/**
 * The two HTML pages the contract viewer serves, with their links as arguments.
 *
 * They live here and not in `server.mjs` because there are two callers with
 * different link shapes: the local server answers `/roles` and `/openapi.yaml`
 * as routes, while the GitHub Pages build writes `roles.html` and
 * `openapi.yaml` as files next to the index. Everything else about the two
 * views is identical, and the role matrix is 40 lines of markup that must not
 * exist twice.
 */

import { operations, loadSpec } from '../openapi-source.mjs';
import { dump } from 'js-yaml';

/**
 * The contract's `servers` point at production/dev URIs. Both viewers prepend
 * the local contract mock so Try-it-out hits the running mock (npm run mock,
 * port 3820) instead of a not-yet-real production host. The source file is
 * untouched; the raw contract stays on offer separately.
 *
 * This works from the https:// Pages site too: browsers treat `127.0.0.1` as a
 * potentially-trustworthy origin, so it is exempt from mixed-content blocking,
 * and `mock/server.mjs` already answers with `access-control-allow-origin: *`.
 */
const LOCAL_MOCK_SERVER = {
  url: 'http://127.0.0.1:3820/api/v1',
  description: '本地契约 mock（npm run mock → node mock/server.mjs）',
};

export function specForUi() {
  const spec = loadSpec();
  spec.servers = [LOCAL_MOCK_SERVER, ...(spec.servers || [])];
  return dump(spec, { lineWidth: -1 });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

/**
 * @param {{specUrl: string, rolesUrl: string, rawUrl: string, note: string}} links
 */
export function indexPage({ specUrl, rolesUrl, rawUrl, note }) {
  return `<!doctype html>
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
  化龙幼儿园三端共用后端 API 契约 &mdash; 来源 <code>hualong-backend/api/openapi.yaml</code>
  &middot; ${note}
  <a href="${rolesUrl}">按角色查看（x-hualong-roles）</a>
  <a href="${rawUrl}">原始契约</a>
</div>
<div id="swagger-ui"></div>
<script src="./swagger-ui-bundle.js"></script>
<script src="./swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: '${specUrl}',
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
}

/**
 * The view stock Swagger UI cannot give: authorization at a glance.
 *
 * @param {{homeUrl: string, rawUrl: string}} links
 */
export function rolesPage({ homeUrl, rawUrl }) {
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
<div class="hl-bar">化龙 API · 角色矩阵<a href="${homeUrl}">回到 Swagger UI</a><a href="${rawUrl}">原始 YAML</a></div>
<div class="sum">共 <b>${rows.length}</b> 个操作，其中教师端可达 <b>${teacherCount}</b> 个（浅蓝行）。
越权回 <b>404</b> 不回 403（契约 §7.2）；401 只用于无会话与会话失效。</div>
<table><thead><tr>
<th>方法</th><th>路径</th><th>x-hualong-roles</th><th>action_key</th><th>成功码</th><th>阻断</th>
</tr></thead><tbody>
${cells}
</tbody></table></body></html>`;
}
