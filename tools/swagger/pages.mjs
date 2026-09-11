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
import { buildPageView, screenGroupedSpec } from '../lib/screen-ops-data.mjs';
import { dump } from 'js-yaml';

/**
 * ELI10（Explain Like I Am 10）—— 每个操作一段人话，写在
 * `hualong-backend/db/spec/operation-eli10.tsv`，**不写在契约里**。
 *
 * 理由三条：①不往 478KB 的共享契约里塞 167 行人工文本；②这份函数本来就在改 spec
 * （下面往 servers 前面插本地后端）；③契约是手写的权威，注入物不该混进去。
 *
 * 代价：翻 `openapi.yaml` 找不到 ELI10。下一个人要知道它从哪来 —— 记在
 * hualong-teacher 的 CLAUDE.md §7。
 */
function eli10Markdown() {
  const { eli10 } = buildPageView();
  const out = new Map();
  for (const [key, r] of eli10) {
    if (!r['幹嘛']) continue;
    const lines = [`**⋯⋯说人话：${r['幹嘛']}**`];
    if (r['怎麼走']) lines.push('', `*怎么走*：${r['怎麼走']}`);
    if (r['碰到誰']) lines.push('', ...r['碰到誰'].split('\n').map((l) => `*${l}*`));
    out.set(key, lines.join('\n'));
  }
  return out;
}

/** 把 ELI10 注进每个 operation 的 description 前面（原文一个字不动）。 */
function injectEli10(spec) {
  const map = eli10Markdown();
  for (const item of Object.values(spec.paths || {})) {
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[m];
      if (!op || !op.operationId) continue;
      const add = map.get(op.operationId);
      if (!add) continue;
      op.description = `${add}\n\n---\n\n${op.description || ''}`.trimEnd();
    }
  }
  return spec;
}

/** 每个操作的 ELI10 摘要（一行），给 /roles 表用。 */
function eli10OneLine() {
  const { eli10 } = buildPageView();
  const out = new Map();
  for (const [key, r] of eli10) if (r['幹嘛']) out.set(key, r['幹嘛']);
  return out;
}

/**
 * The contract's `servers` point at production/dev URIs. Both viewers prepend
 * the local testdata API (port 3860) and the contract mock (port 3820),
 * so Try-it-out can exercise real database calculations. The source file is
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

const LOCAL_TESTDATA_SERVER = {
  url: 'http://127.0.0.1:3860/api/v1',
  description: '本地测试后端（真实测试数据库，与教师小程序共用）',
};

export function specForUi() {
  const spec = injectEli10(loadSpec());
  spec.servers = [LOCAL_TESTDATA_SERVER, LOCAL_MOCK_SERVER, ...(spec.servers || [])];
  return dump(spec, { lineWidth: -1 });
}

/** 派生 spec：167 个操作全保留，按屏幕分组。给 `/pages.yaml` 用。 */
export function pagesSpecForUi() {
  const spec = injectEli10(screenGroupedSpec());
  spec.servers = [LOCAL_TESTDATA_SERVER, LOCAL_MOCK_SERVER, ...(spec.servers || [])];
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
export function indexPage({ specUrl, rolesUrl, pagesUrl = '', rawUrl, note }) {
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
  ${pagesUrl ? `<a href="${pagesUrl}">按屏幕查看（某一页要用哪些 API）</a>` : ''}
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
export function rolesPage({ homeUrl, rawUrl, pagesUrl = '', specUrl = '' }) {
  const rows = operations(loadSpec());
  const eli = eli10OneLine();
  const cells = rows.map((r) => `<tr class="${r.roles.includes('teacher') ? 'teacher' : ''}">
      <td class="m m-${r.method}">${r.method}</td>
      <td><code>${escapeHtml(r.path)}</code></td>
      <td class="why">${escapeHtml(eli.get(r.operationId) || '')}</td>
      <td>${r.isPublic ? '<em>登录前公开</em>' : escapeHtml(r.roles.join(', ')) || '<b class="bad">无</b>'}</td>
      <td>${escapeHtml(r.actions.join('<br>')) || '&mdash;'}</td>
      <td>${escapeHtml(r.successCodes.join(', ')) || '&mdash;'}</td>
      <td>${r.blockedOn.length ? `<b class="bad">${escapeHtml(r.blockedOn.join('; '))}</b>` : '&mdash;'}</td>
    </tr>`).join('\n');

  const teacherCount = rows.filter((r) => r.roles.includes('teacher')).length;
  const eliCount = rows.filter((r) => eli.has(r.operationId)).length;
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
 .why { color:#475569; font-size:12.5px; max-width: 30ch; }
 code { font: 13px/1.4 ui-monospace, Consolas, monospace; }
 .sum { padding: 10px 16px; background:#fffbeb; }
</style></head><body>
<div class="hl-bar">化龙 API · 角色矩阵<a href="${homeUrl}">回到 Swagger UI</a>${pagesUrl ? `<a href="${pagesUrl}">按屏幕看</a>` : ''}${specUrl ? `<a href="${specUrl}">按屏幕看的规格</a>` : ''}<a href="${rawUrl}">原始 YAML</a></div>
<div class="sum">共 <b>${rows.length}</b> 个操作，其中教师端可达 <b>${teacherCount}</b> 个（浅蓝行）。
已写「说人话」的 <b>${eliCount}/${rows.length}</b>（来源：<code>db/spec/operation-eli10.tsv</code>，不在契约里）。
越权回 <b>404</b> 不回 403（契约 §7.2）；401 只用于无会话与会话失效。</div>
<table><thead><tr>
<th>方法</th><th>路径</th><th>说人话</th><th>x-hualong-roles</th><th>action_key</th><th>成功码</th><th>阻断</th>
</tr></thead><tbody>
${cells}
</tbody></table></body></html>`;
}
