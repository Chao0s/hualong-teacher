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
  // 「核到什么程度」要跟着文字一起走 —— 只在 /pages 上写一次，读 Swagger 的人就看不到。
  // 措辞随事实走：机器交叉核过一遍（167 条里 11 条说不准、已改），但**没有人逐条读过**。
  const CAVEAT = '*⋯⋯段「说人话」由机器起草。机器已交叉核过一遍（167 条里发现 11 条说不准、已修正），**但仍无人逐条读过** —— 引用前请自己核一遍。*';
  for (const [key, r] of eli10) {
    if (!r['幹嘛']) continue;
    const lines = [`**⋯⋯说人话：${r['幹嘛']}**`];
    if (r['怎麼走']) lines.push('', `*怎么走*：${r['怎麼走']}`);
    if (r['碰到誰']) lines.push('', ...r['碰到誰'].split('\n').map((l) => `*${l}*`));
    lines.push('', CAVEAT);
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
 * 原文的「人读」视图：把 YAML 原样放进一个自声明 UTF-8 的 HTML 里。
 *
 * **不是为了好看，是为了编码。** GitHub Pages 把 `.yaml` 发成 `Content-Type: text/yaml`，
 * **没有 `charset`**。浏览器用 URL 直接打开这种响应时不会默认 UTF-8，而是退回系统编码
 * （中文 Windows 上是 GBK/ANSI），于是整篇中文变成 `å¤-é%™` 那样的乱码。
 * 文件本身是合法 UTF-8（复核过：无 BOM、无替换字符）—— **坏的是 header，不是文件**。
 *
 * 本地的 `tools/swagger/server.mjs` 不受影响：它发 `application/yaml; charset=utf-8`。
 * 所以这个包裹页只在 Pages 构建时生成，`.yaml` 原件仍留作下载。
 *
 * API 给的 `fetch()` 也不受影响（对 `text/*` 默认 UTF-8），所以 Swagger UI 一直正常 ——
 * 只有「人点原始契约那个链接」这一条路会踩到。
 */
export function rawViewer({ text, title, backUrl, backLabel, downloadUrl, downloadLabel }) {
  const shown = text.length > 400000
    ? `${text.slice(0, 200000)}\n\n…（中间省略 ${text.length - 400000} 字符，用下面的下载链接取全文）…\n\n${text.slice(-200000)}`
    : text;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
 body { margin: 0; background: #f6fbfa; color: #1f3a37;
        font: 13px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
 .hl-bar { position: sticky; top: 0; z-index: 2; background: #e4f1ee; color: #12413c;
           padding: 9px 16px; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
           display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
 .hl-bar a { color: #0f6b62; text-decoration: none; }
 .hl-bar a:hover { text-decoration: underline; }
 .hl-bar .meta { margin-left: auto; color: #55766f; font-size: 12px; }
 pre { margin: 0; padding: 14px 16px 40px; white-space: pre; overflow-x: auto; tab-size: 2; }
</style>
</head>
<body>
<div class="hl-bar">
  <a href="${backUrl}">${escapeHtml(backLabel)}</a>
  <a href="${downloadUrl}" download>${escapeHtml(downloadLabel)}</a>
  <span class="meta">${escapeHtml(title)} &middot; ${shown.length.toLocaleString('en-US')} 字符 &middot; 本页以 UTF-8 声明，原文与下载件逐字节相同</span>
</div>
<pre>${escapeHtml(shown)}</pre>
</body>
</html>
`;
}

/**
 * @param {{specUrl: string, rolesUrl: string, rawUrl: string, note: string}} links
 */
export function indexPage({ specUrl, rolesUrl, pagesUrl = '', rawUrl, rawViewerUrl = '', note }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API 契约 · Swagger UI</title>
<link rel="stylesheet" href="./swagger-ui.css">
<style>
  body { margin: 0; background: #eef5f3; }
  .hl-bar { background: #e4f1ee; color: #12413c; padding: 10px 16px;
            font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .hl-bar a { color: #0a6472; margin-left: 16px; }
  .hl-bar code { color: #0d5a53; }
</style>
</head>
<body>
<div class="hl-bar">
  化龙幼儿园三端共用后端 API 契约 &mdash; 来源 <code>hualong-backend/api/openapi.yaml</code>
  &middot; ${note}
  <a href="${rolesUrl}">按角色查看（x-hualong-roles）</a>
  ${pagesUrl ? `<a href="${pagesUrl}">按屏幕查看（某一页要用哪些 API）</a>` : ''}
  <a href="${rawUrl}">原始契约</a>
  ${rawViewerUrl ? `<a href="${rawViewerUrl}">原始契约（HTML，中文不乱码）</a>` : ''}
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
 * 七列。列名只写一份 —— 顶栏下面那条 sticky 图例用它，168 行里不再重复。
 */
const ROLE_HEAD = ['方法', '路径', '说人话', 'x-hualong-roles', 'action_key', '成功码', '阻断'];

/**
 * 长路径在 `/` 后插一个 `<wbr>`：折行落在路径分隔符上，不是断在词中间。
 * 短路径一行放得下，不插。与 `pages-view.mjs` 同一套写法，理由写在那里。
 */
const WBR_OVER = 28;
const escPath = (p) => {
  const s = escapeHtml(p);
  return s.length > WBR_OVER ? s.replace(/\//g, '/<wbr>') : s;
};

/**
 * The view stock Swagger UI cannot give: authorization at a glance.
 *
 * 列宽只写一处（下面 `.tbl` 的 `:nth-child`），与 /pages 同一套写法，理由见
 * `pages-view.mjs` 头注：`table-layout: fixed` + 一处定宽，任意两行的同一列等宽。
 * 除「说人话」外全部定宽，那一列拿余量 —— 它是给人读的，机器键 `action_key` 不是。
 *
 * 上一版的三个版面缺陷在这里修掉：
 *   ① `escapeHtml(r.actions.join('<br>'))` —— `<br>` 被一起转义，那 10 个 action_key
 *      渲染成一行 226 字的不可断文本，把这一列撑到 1489px，页面横向滚 1178px。
 *   ② `table-layout: auto` —— 列宽由内容决定，`阻断` 被挤成 121px 反复折行，
 *      `说人话` 只剩 127px，最高一行 237px。
 *   ③ 表头只有 `position:sticky` 的 `<th>`，滚过一屏就没了；现在是顶栏下那条图例。
 *
 * @param {{homeUrl: string, rawUrl: string, pagesUrl?: string, specUrl?: string}} links
 */
export function rolesPage({ homeUrl, rawUrl, rawViewerUrl = '', pagesUrl = '', specUrl = '' }) {
  const rows = operations(loadSpec());
  const eli = eli10OneLine();
  const cells = rows.map((r) => `<tr class="r ${r.method}${r.roles.includes('teacher') ? ' t' : ''}">`
    + `<td>${r.method}</td>`
    + `<td>${escPath(r.path)}</td>`
    + `<td>${escapeHtml(eli.get(r.operationId) || '')}</td>`
    + `<td>${r.isPublic ? '<em>登录前公开</em>' : escapeHtml(r.roles.join(', ')) || '<b class="bad">无</b>'}</td>`
    + `<td>${r.actions.length ? r.actions.map((a) => `<b>${escapeHtml(a)}</b>`).join(' ') : '<i class="mut">&mdash;</i>'}</td>`
    + `<td>${escapeHtml(r.successCodes.join(', ')) || '<i class="mut">&mdash;</i>'}</td>`
    + `<td>${r.blockedOn.length ? `<b class="bad">${escapeHtml(r.blockedOn.join('; '))}</b>` : '<i class="mut">&mdash;</i>'}</td>`
    + '</tr>').join('');

  const teacherCount = rows.filter((r) => r.roles.includes('teacher')).length;
  const eliCount = rows.filter((r) => eli.has(r.operationId)).length;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API · 角色矩阵</title>
<style>
 :root{
  --bg:#eef5f3; --panel:#fff; --panel2:#f5faf9; --bar:#e4f1ee;
  --bar-ink:#12413c; --bar-link:#0f6b62;
  --ink:#10302d; --ink2:#35564f; --ink3:#55766f; --ink4:#73908a;
  --line:#d5e6e2; --line2:#e7f1ef; --blue:#e8f4f9; --link:#0a6472;
  --ok:#0b7a4b; --warn:#9a5a06; --bad:#ad2b2b; --violet:#6b4fa8;
  --mono:ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  --sans:system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --pad-page:16px; --pad-card:14px;
  --inset:calc(var(--pad-page) + var(--pad-card) + 1px);
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 var(--sans);
      -webkit-text-size-adjust:100%}
 a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
 code{font:12.5px/1.4 var(--mono)}
 .top{position:sticky;top:0;z-index:9}
 .hl-bar{background:var(--bar);color:var(--bar-ink);padding:9px 16px;display:flex;
         flex-wrap:wrap;align-items:baseline;gap:2px 14px;font-size:13.5px;
         border-bottom:1px solid var(--line)}
 .hl-bar a{color:var(--bar-link);margin:0}
 .hl-bar a:hover{text-decoration:underline}
 /* 汇总条是说明，不是警告：中性底 + 一条细的左侧标尺。与 /pages 同一套。 */
 .sum{padding:11px 16px;background:var(--panel2);color:var(--ink2);
      border-bottom:1px solid var(--line);border-left:3px solid var(--ink4);font-size:13px}
 .sum b{color:var(--ink);font-weight:650} .sum code{color:var(--ink3)}
 .legend{padding:0 var(--inset)} .legend th{font:600 11px/1.5 var(--sans);
          letter-spacing:.06em;color:var(--ink3);white-space:nowrap}

 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
       margin:14px var(--pad-page) 40px;padding:0 var(--pad-card);overflow:hidden}
 .tbl{width:100%;table-layout:fixed;border-collapse:collapse}
 /* 右边留一道 14px 沟：没有沟时相邻两列的正文会贴在一起。末列不留。 */
 .tbl th,.tbl td{padding:7px 14px 7px 0;text-align:left;vertical-align:top;
                 border-bottom:1px solid var(--line2);overflow-wrap:break-word}
 .tbl th:last-child,.tbl td:last-child{padding-right:0}
 .tbl th{padding-bottom:5px}
 /* 一处定宽，七列共用。第 3 列（说人话）不定宽，fixed 布局把余量全给它。
    第 5 列 280px 是按最长那一格定的：10 个 action_key 每个 19 字，280px 刚好放下两个
    （2×19+1 = 39 字 × 6.9px ≈ 269px），于是那一格 5 行而不是 10 行。它是全表唯一的长格。 */
 .tbl th:nth-child(1),.tbl td:nth-child(1){width:56px}
 .tbl th:nth-child(2),.tbl td:nth-child(2){width:204px}
 .tbl th:nth-child(4),.tbl td:nth-child(4){width:116px}
 .tbl th:nth-child(5),.tbl td:nth-child(5){width:280px}
 .tbl th:nth-child(6),.tbl td:nth-child(6){width:56px}
 .tbl th:nth-child(7),.tbl td:nth-child(7){width:168px}
 .tbl td{border-bottom-color:var(--line2)}
 .tbl tbody tr:last-child td{border-bottom:0}
 /* 说人话：给人读的那一列，行距放松、色压一档。 */
 .tbl td:nth-child(3){color:var(--ink2);line-height:1.6}
 .tbl td:nth-child(1){font:11.5px/1.6 var(--mono);font-weight:700;white-space:nowrap}
 .tbl td:nth-child(2){font:12.5px/1.5 var(--mono);color:var(--ink2)}
 .tbl td:nth-child(4){font-size:12.5px}
 .tbl td:nth-child(5),.tbl td:nth-child(6){font-size:12px}
 .tbl td:nth-child(7){font-size:12.5px;line-height:1.5}
 /* action_key 是机器键：等宽、压小、允许在任意位置折行。它是 167 行里最长的一格
    （226 字／10 个键），给成 inline-block 会一格一行、把那一行顶到 260px。 */
 .tbl td:nth-child(5) b{font:600 11.5px/1.7 var(--mono)}
 .r.GET td:nth-child(1){color:var(--ok)} .r.POST td:nth-child(1){color:var(--link)}
 .r.PUT td:nth-child(1){color:var(--warn)} .r.PATCH td:nth-child(1){color:var(--violet)}
 .r.DELETE td:nth-child(1){color:var(--bad)}
 .r.t{background:var(--blue)}
 .bad{color:var(--bad)}
 .mut{font-style:normal;color:var(--ink4)}

 @media (max-width: 1100px){
  :root{--pad-page:12px;--pad-card:12px}
  .legend{display:none}
  .tbl,.tbl tbody,.tbl tr,.tbl td{display:block;width:auto}
  /* 定宽那几条是 .tbl td:nth-child(5)（0,2,1），width:auto 压不住它 —— 竖排时必须
     用同级的 :nth-child(n) 覆盖，否则格子还是桌面宽度，标签与值会挤在 56px 里溢出去。 */
  .tbl th:nth-child(n),.tbl td:nth-child(n){width:auto}
  .tbl tr{padding:9px var(--pad-card);border-bottom:1px solid var(--line2)}
  .tbl td{padding:0;border:0}
  .tbl td:empty{display:none}
  .tbl td::before{content:"";display:inline-block;width:96px;color:var(--ink4);
                  font:600 11px/1.7 var(--sans);letter-spacing:.04em;vertical-align:top}
  .tbl td:nth-child(1)::before{content:"方法"} .tbl td:nth-child(2)::before{content:"路径"}
  .tbl td:nth-child(3)::before{content:"说人话"} .tbl td:nth-child(4)::before{content:"角色"}
  .tbl td:nth-child(5)::before{content:"action_key"} .tbl td:nth-child(6)::before{content:"成功码"}
  .tbl td:nth-child(7)::before{content:"阻断"}
 }
 @media (prefers-reduced-motion: no-preference){ html{scroll-behavior:smooth} }
</style></head><body>
<div class="top">
<div class="hl-bar">化龙 API · 角色矩阵<a href="${homeUrl}">回到 Swagger UI</a>${pagesUrl ? `<a href="${pagesUrl}">按屏幕看</a>` : ''}${specUrl ? `<a href="${specUrl}">按屏幕看的规格</a>` : ''}<a href="${rawUrl}">原始 YAML</a>${rawViewerUrl ? `<a href="${rawViewerUrl}">原文（HTML，中文不乱码）</a>` : ''}</div>
<div class="legend"><table class="tbl"><thead><tr>${ROLE_HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead></table></div>
</div>
<div class="sum">共 <b>${rows.length}</b> 个操作，其中教师端可达 <b>${teacherCount}</b> 个（浅蓝行）。
已写「说人话」的 <b>${eliCount}/${rows.length}</b>（来源：<code>db/spec/operation-eli10.tsv</code>，不在契约里）。
机器已交叉核过一遍（167 条里发现 <b>11 条说不准</b>，已修正），<b>但仍无人逐条读过</b>。
越权回 <b>404</b> 不回 403（契约 §7.2）；401 只用于无会话与会话失效。</div>
<div class="card"><table class="tbl"><tbody>${cells}</tbody></table></div>
</body></html>`;
}
