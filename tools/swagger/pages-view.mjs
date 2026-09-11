/**
 * `/pages` —— 按屏幕看的表页。一屏一卡，卡内四段。
 *
 * 为什么是表页而不是另一个 Swagger 实例：这张页要回答的是「这一页要用的 API 齐了没有」，
 * 不是「调一下试试」。两件事一起上会都不好用。
 *
 * 每行深链进 Swagger UI（`deepLinking` 已开）：`#/<tag>/<operationId>`。
 */
import { buildPageView } from '../lib/screen-ops-data.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VERB = { GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH', DELETE: 'DELETE' };
export { VERB };

/** 一行的两种形态：有契约的（可深链）与还没有契约的（planned，不可点）。 */
function opRow(r, opById, eli10) {
  const op = r.operation_id ? opById.get(r.operation_id) : null;
  const tag = op && op.tags && op.tags[0] ? op.tags[0] : '';
  const link = op ? `/#/${esc(tag)}/${esc(op.operationId)}` : '';
  const name = r.operation_id || `（契约还没有）`;
  const eli = eli10.get(r.operation_id) || (r.key ? eli10.get(r.key) : null);
  const 幹嘛 = eli && eli['幹嘛'] ? `<div class="why">${esc(eli['幹嘛'])}</div>` : '';
  const trig = r.trigger_wxml ? `<span class="trig">${esc(r.trigger_wxml)}</span>` : '<span class="trig none">随页面加载</span>';
  const flag = r.trigger_flag ? `<span class="flag" title="${esc(r.trigger_flag)}">${esc(r.trigger_flag)}</span>` : '';
  const gap = r.gap ? `<span class="gap">${esc(r.gap)}</span>` : '';
  const inner = op
    ? `<a href="${link}"><code>${esc(name)}</code></a>`
    : `<code>${esc(name)}</code>`;
  return `<tr class="src-${esc(r.source)}">
    <td class="st">${esc(r.state)}</td>
    <td class="m${r.method ? ` m-${VERB[r.method] || 'GET'}` : ''}">${esc(r.method || '')}</td>
    <td class="p">${op ? `<a href="${link}"><code>${esc(r.path)}</code></a>` : `<code>${esc(r.path)}</code>`}</td>
    <td class="op">${inner}${幹嘛}</td>
    <td class="tg">${trig}${flag}</td>
    <td class="gp">${gap}</td>
  </tr>`;
}

/**
 * 一屏的行分五段。分段的判据必须照 `source` + `gap` 来，不能只看有没有 operation_id：
 * `no-api` 行按定义也没有 operation_id，只看那个会把它错报成「契约还没有」。
 *
 *   已实作               gen／human 且没有 gap
 *   契约有、页面没调     有人工 gap 的行 —— 页面该调而没调，那是缺陷不是实作
 *   页面要用、契约没有    planned
 *   按设计不调任何操作    no-api
 *   上一轮调过这轮不调    stale
 */
export function bucketOf(rows) {
  const has = (r) => Boolean((r.gap || '').trim());
  return {
    impl: rows.filter((r) => (r.source === 'gen' || r.source === 'human') && !has(r)),
    notCalled: rows.filter((r) => r.operation_id && has(r)),
    needsApi: rows.filter((r) => r.source === 'planned'),
    noApi: rows.filter((r) => r.source === 'no-api'),
    stale: rows.filter((r) => r.source === 'stale'),
  };
}

/**
 * @param {{homeUrl: string, rolesUrl: string, rawUrl: string, specUrl: string}} links
 */
export function pagesPage({ homeUrl, rolesUrl, rawUrl, specUrl }) {
  const { screenOps, byScreen, eli10, opById, titles, unused, notTeacher, unusedNoService } = buildPageView();
  const rowsOf = (screen) => (byScreen.get(screen) || []).map((r) => opRow(r, opById, eli10)).join('\n');

  const cards = [...byScreen.keys()].sort().map((screen) => {
    const rows = byScreen.get(screen);
    const { impl, notCalled, needsApi, noApi, stale } = bucketOf(rows);
    const bits = [];
    if (impl.length) bits.push(`<h3>已实作 <span class="n">${impl.length}</span></h3><table>${impl.map((r) => opRow(r, opById, eli10)).join('')}</table>`);
    if (notCalled.length) bits.push(`<h3 class="warn">契约有、这一屏没调 <span class="n">${notCalled.length}</span></h3><table>${notCalled.map((r) => opRow(r, opById, eli10)).join('')}</table>`);
    if (needsApi.length) bits.push(`<h3 class="warn">页面要用而契约没有 <span class="n">${needsApi.length}</span></h3><table>${needsApi.map((r) => opRow(r, opById, eli10)).join('')}</table>`);
    if (noApi.length) bits.push(`<h3 class="dim">按设计不调任何操作 <span class="n">${noApi.length}</span></h3><p class="note">${esc(noApi.map((r) => r.notes).join('；'))}</p>`);
    if (stale.length) bits.push(`<h3 class="warn">上一轮调过、这一轮不调了 <span class="n">${stale.length}</span></h3><table>${stale.map((r) => opRow(r, opById, eli10)).join('')}</table>`);
    const label = titles.get(screen) || screen;
    return `<section class="card" id="s-${esc(screen)}">
  <header><h2>${esc(label)}</h2><code class="dir">miniprogram/pages/${esc(screen)}/</code><span class="cnt">${rows.length} 条</span></header>
  ${bits.join('\n  ') || '<p class="note">这一屏没有任何记录，且不是 no-api —— 是一个缺口（缺行与「本来就没有」必须分得开）。</p>'}
</section>`;
  }).join('\n');

  const nNeedsApi = [...byScreen.values()].filter((rows) => bucketOf(rows).needsApi.length > 0).length;
  const nNotCalled = [...byScreen.values()].filter((rows) => bucketOf(rows).notCalled.length > 0).length;
  const unusedRows = unused.map((o) => `<tr><td class="m m-${o.method}">${o.method}</td><td><code>${esc(o.path)}</code></td>
    <td>${esc(o.operationId)}</td><td class="why">${esc((eli10.get(o.operationId) || {})['幹嘛'] || '')}</td>
    <td>${unusedNoService.has(o.path) ? '<b>service 层也没写</b>' : 'service 层写了，没有页面走得到'}</td>
    <td><a href="/#/${esc((o.tags || [])[0] || '')}/${esc(o.operationId)}">Swagger</a></td></tr>`).join('\n');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API · 按屏幕看</title>
<style>
 body { font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
 .hl-bar { background:#1f2937; color:#f9fafb; padding:10px 16px; position: sticky; top: 0; z-index: 5; }
 .hl-bar a { color:#93c5fd; margin-left:16px; }
 code { font: 13px/1.4 ui-monospace, Consolas, monospace; }
 .sum { padding: 12px 16px; background:#fffbeb; border-bottom:1px solid #fde68a; }
 .sum b { color:#b45309; }
 .card { background:#fff; margin:14px 16px; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; }
 .card header { display:flex; align-items:baseline; gap:10px; padding:10px 14px; background:#f1f5f9; border-bottom:1px solid #e2e8f0; }
 .card h2 { font-size:15px; margin:0; }
 .dir { color:#64748b; font-size:12px; }
 .cnt { margin-left:auto; color:#64748b; font-size:12px; }
 h3 { font-size:13px; margin:12px 14px 4px; color:#047857; }
 h3.warn { color:#b45309; }
 h3.dim { color:#64748b; }
 h3 .n { color:#94a3b8; font-weight:400; }
 table { border-collapse: collapse; width: 100%; }
 td { border-bottom:1px solid #f1f5f9; padding:5px 10px; vertical-align:top; }
 td.st { color:#64748b; font:12px ui-monospace, monospace; white-space:nowrap; }
 td.m { font-weight:700; white-space:nowrap; width:1%; }
 .m-GET{color:#047857}.m-POST{color:#1d4ed8}.m-PUT{color:#b45309}.m-PATCH{color:#7c3aed}.m-DELETE{color:#b91c1c}
 td.tg, td.gp { white-space:nowrap; width:1%; }
 .trig { background:#eef2ff; color:#3730a3; border-radius:4px; padding:1px 6px; font-size:12px; }
 .trig.none { background:transparent; color:#94a3b8; }
 .flag { background:#fef3c7; color:#92400e; border-radius:4px; padding:1px 6px; font-size:12px; margin-left:4px; }
 .gap { background:#fee2e2; color:#991b1b; border-radius:4px; padding:1px 6px; font-size:12px; }
 .why { color:#475569; font-size:12px; margin-top:2px; }
 tr.src-stale td { background:#fff7ed; }
 tr.src-no-api td { background:#f8fafc; }
 .note { color:#64748b; margin:6px 14px 12px; font-size:13px; }
 a { color:#1d4ed8; text-decoration:none; } a:hover { text-decoration:underline; }
</style></head><body>
<div class="hl-bar">化龙 API · <b>按屏幕看</b>
  <a href="${homeUrl}">按模块看（Swagger UI）</a>
  <a href="${rolesUrl}">角色矩阵</a>
  <a href="${specUrl}">按屏幕看的规格</a>
  <a href="${rawUrl}">原始 YAML</a>
</div>
<div class="sum">
 教师端 <b>${byScreen.size}</b> 屏有记录（共 ${screenOps.length} 条）。
 其中 <b>${nNotCalled}</b> 屏有「契约有、这一屏没调」的行，<b>${nNeedsApi}</b> 屏有「契约还没有」的行。
 契约里教师可达但<b>没有任何页面调用</b>的操作：<b>${unused.length}</b> 条（列在文末）。
 非教师角色（家长端／管理端）的操作 <b>${notTeacher.length}</b> 条，本轮不映射它们的屏幕。
</div>
${cards}
<section class="card" id="unused">
  <header><h2>无人认领的操作</h2><span class="cnt">${unused.length} 条</span></header>
  <table><thead><tr><th>方法</th><th>路径</th><th>operationId</th><th>幹嘛</th><th>service 层</th><th></th></tr></thead>
  <tbody>${unusedRows}</tbody></table>
  <p class="note">判据分两层：<b>service 层也没写</b> = 客户端一处都没有；<b>service 层写了、没有页面走得到</b> = 有导出函数但没有任何页面调到它。两者要修的东西不一样。</p>
</section>
</body></html>`;
}
