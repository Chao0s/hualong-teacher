/**
 * `/pages` —— 按屏幕看的表页。一屏一卡，卡内按发现种类分段。
 *
 * 为什么是表页而不是另一个 Swagger 实例：这张页要回答的是「这一页要用的 API 齐了没有」，
 * 不是「调一下试试」。两件事一起上会都不好用。
 *
 * 每行的操作深链进 Swagger UI（`deepLinking` 已开）：`#/<tag>/<operationId>`。
 *
 * ## 列宽的写法（改这里之前先读这一段）
 *
 * 50 张表各自独立。`table-layout: auto` 让每张表自己算列宽，于是同一列在两张卡上宽度
 * 不同 —— 1280 视口实测路径列 176–653px，操作列 270–771px。所以这里：
 *
 *   ① 每张表 `table-layout: fixed`；
 *   ② 列宽**只写一处**（下面的 `.tbl th/td:nth-child(n)`），七列共用；
 *   ③ 除「说人话」外全部定宽，那一列不定宽、由 fixed 布局把余量全给它。
 *
 * 于是任意两张卡的同一列宽度相同，且人读的那一列拿到最宽的一份。
 * **不要**在行里加列类名或 `<colgroup>` —— 列身份一律靠 `:nth-child`，
 * 否则宽度会重新分散到 50 张表上（也正是加 `<colgroup>` 会多出 7KB 的原因）。
 *
 * ## 表头
 *
 * 表头只有一份，是页面顶部那条 sticky 图例（`.legend`）。理由：每张卡重复一次表头是
 * 50 次噪音；而图例 sticky 之后始终贴顶，读哪张卡都看得见列名，也就不需要每张卡再有。
 */
import { buildPageView } from '../lib/screen-ops-data.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 长路径在 `/` 后插一个 `<wbr>`：折行落在路径分隔符上，而不是断在词中间。
 * 短路径本来一行放得下，不插 —— 每行省几个字节，141 行就是几 KB。
 * 配合 `overflow-wrap: break-word`（不是 `anywhere`）：有 `<wbr>` 就优先在那儿断，
 * 某一段实在太长时仍会兜底断开，不会溢出。
 */
const WBR_OVER = 28;
const escPath = (p) => {
  const s = esc(p);
  return s.length > WBR_OVER ? s.replace(/\//g, '/<wbr>') : s;
};

/** 七列。列名只在这里写一份，页面顶部图例用它。 */
const HEAD = ['状态', '方法', '路径', '操作', '说人话', '触发', '缺口'];

/**
 * 一行的两种形态：有契约的（可深链）与还没有契约的（planned，不可点）。
 *
 * 一列只干一件事：`操作` 列是标识（operationId，唯一可点的那处），`说人话` 列是解释。
 * 两样合在一格是上一版的毛病 —— 30–60 字的解释把标识挤成了脚注。
 *
 * 一格 0 条时**留空格子**，不写「—」：这一列本来就没有东西可指，写个占位符只是噪音。
 * 表头那一条图例已经说明这一列是什么。
 */
function opRow(r, opById, eli10) {
  const op = r.operation_id ? opById.get(r.operation_id) : null;
  const href = op ? `/#/${esc((op.tags || [])[0] || '')}/${esc(op.operationId)}` : '';
  const name = r.operation_id || '（契约还没有）';
  const why = (eli10.get(r.operation_id) || eli10.get(r.key) || {})['幹嘛'] || '';
  const trig = r.trigger_wxml ? esc(r.trigger_wxml) : '<i class="mut">随页面加载</i>';
  const flag = r.trigger_flag ? `<b class="chip">${esc(r.trigger_flag)}</b>` : '';
  const gap = r.gap ? `<b class="chip bad">${esc(r.gap)}</b>` : '';
  const cls = `r${r.method ? ` ${r.method}` : ''}${r.source === 'stale' ? ' stale' : r.source === 'no-api' ? ' noapi' : ''}`;
  return `<tr class="${cls}">`
    + `<td>${esc(r.state)}</td>`
    + `<td>${esc(r.method || '')}</td>`
    + `<td>${escPath(r.path)}</td>`
    + `<td>${href ? `<a href="${href}">${esc(name)}</a>` : esc(name)}</td>`
    + `<td>${esc(why)}</td>`
    + `<td>${trig}${flag}</td>`
    + `<td>${gap}</td>`
    + '</tr>';
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

/** 五段的名字与色调。分段表与卡头计数条共用一份，两处不会漂开。 */
const SEGMENTS = [
  ['impl', '已实作', 'ok'],
  ['notCalled', '契约有、这一屏没调', 'warn'],
  ['needsApi', '页面要用而契约没有', 'warn'],
  ['noApi', '按设计不调任何操作', 'dim'],
  ['stale', '上一轮调过、这一轮不调了', 'dim'],
];

/**
 * 每张卡抬头的计数条。
 *
 * **0 条要说话。** 上一版是 `bits.join` —— 某一段 0 条就整段消失，于是「一段都没有」
 * 与「这一段没查」在屏幕上长得一样。计数条把五段全列出来，0 也写出来（数字压暗）。
 * 段本身仍然不渲染空表：0 条没有行可看，一条空表只有噪音。
 */
function countStrip(b) {
  return '<p class="bk">' + SEGMENTS
    .map(([k, title, tone]) => {
      const n = b[k].length;
      return `<span class="${tone}${n ? '' : ' z'}">${title} <b>${n}</b></span>`;
    })
    .join('') + '</p>';
}

/**
 * @param {{homeUrl: string, rolesUrl: string, rawUrl: string, specUrl: string}} links
 */
export function pagesPage({ homeUrl, rolesUrl, rawUrl, rawViewerUrl = '', specUrl, specViewerUrl = '' }) {
  const { screenOps, byScreen, eli10, opById, titles, unused, notTeacher, unusedNoService, serviceReport } = buildPageView();

  const cards = [...byScreen.keys()].sort().map((screen) => {
    const rows = byScreen.get(screen);
    const b = bucketOf(rows);
    const label = titles.get(screen) || screen;
    const body = SEGMENTS.map(([k, title, tone]) => {
      const list = b[k];
      if (!list.length) return '';
      if (k === 'noApi') {
        return `<div class="sec"><h3 class="${tone}">${title}</h3>`
          + `<p class="note">${esc(list.map((r) => r.notes).join('；'))}</p></div>`;
      }
      return `<div class="sec"><h3 class="${tone}">${title}</h3>`
        + `<table class="tbl"><tbody>${list.map((r) => opRow(r, opById, eli10)).join('')}</tbody></table></div>`;
    }).join('');
    return `<section class="card" id="s-${esc(screen)}">`
      + `<header><h2>${esc(label)}</h2><code class="dir">miniprogram/pages/${esc(screen)}/</code>`
      + `<span class="cnt">${rows.length} 条</span></header>`
      + countStrip(b)
      + (body || '<p class="note">这一屏没有任何记录，且不是 no-api —— 是一个缺口（缺行与「本来就没有」必须分得开）。</p>')
      + '</section>';
  }).join('\n');

  const nNeedsApi = [...byScreen.values()].filter((rows) => bucketOf(rows).needsApi.length > 0).length;
  const nNotCalled = [...byScreen.values()].filter((rows) => bucketOf(rows).notCalled.length > 0).length;

  const unusedRows = unused.map((o) => {
    const why = (eli10.get(o.operationId) || {})['幹嘛'] || '';
    const verdict = !serviceReport ? '<i class="mut">没读到裁决报告</i>'
      : unusedNoService.has(o.path) ? '<b class="chip bad">service 层也没写</b>'
        : 'service 层写了，没有页面走得到';
    const href = `/#/${esc((o.tags || [])[0] || '')}/${esc(o.operationId)}`;
    return `<tr class="r${o.method ? ` ${o.method}` : ''}">`
      + '<td></td>'
      + `<td>${esc(o.method)}</td>`
      + `<td>${escPath(o.path)}</td>`
      + `<td>${esc(o.operationId)}</td>`
      + `<td>${esc(why)}</td>`
      + `<td>${verdict}</td>`
      + `<td><a href="${href}">Swagger</a></td>`
      + '</tr>';
  }).join('');

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API · 按屏幕看</title>
<style>
 /* 一份 token，两处用：浅色与深色各一套变量，其余规则只认变量名。 */
 :root{
  --bg:#f4f6fa; --panel:#fff; --panel2:#f8fafc; --bar:#1f2937;
  --ink:#0f172a; --ink2:#475569; --ink3:#64748b; --ink4:#94a3b8;
  --line:#e3e8ef; --line2:#eef2f7;
  --link:#1d4ed8; --accent:#eef2ff; --accent-ink:#3730a3;
  --ok:#047857; --warn:#b45309;
  --bad:#b91c1c; --bad-bg:#fee2e2;
  --mono:ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  --sans:system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif;
  --pad-page:16px; --pad-card:14px;
  --inset:calc(var(--pad-page) + var(--pad-card) + 1px);
 }
 @media (prefers-color-scheme: dark){
  :root{
   --bg:#0b1220; --panel:#111a2b; --panel2:#0e1728; --bar:#0a0f1a;
   --ink:#e7edf5; --ink2:#c2ccd9; --ink3:#94a3b8; --ink4:#64748b;
   --line:#243044; --line2:#1b2537;
   --link:#93c5fd; --accent:#1b2740; --accent-ink:#bfdbfe;
   --ok:#34d399; --warn:#fbbf24; --bad:#f87171; --bad-bg:#2a1414;
  }
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 var(--sans);
      -webkit-text-size-adjust:100%}
 a{color:var(--link);text-decoration:none}
 a:hover{text-decoration:underline}
 code{font:12.5px/1.4 var(--mono)}

 /* 顶栏 + 图例共用一个 sticky 容器 —— 两截贴顶时不用猜顶栏高度。 */
 .top{position:sticky;top:0;z-index:9}
 .hl-bar{background:var(--bar);color:#f9fafb;padding:9px 16px;display:flex;
         flex-wrap:wrap;align-items:baseline;gap:2px 14px;font-size:13.5px}
 .hl-bar b{color:#fff}
 .hl-bar a{color:#93c5fd;text-decoration:none}
 .hl-bar a:hover{text-decoration:underline}
 .hl-bar .now{margin-left:auto;color:#94a3b8;font-size:12px}

 /* 表头：一份，贴在图例条里，宽度与每张卡的表格逐列相同（同一套 fixed 轨道）。 */
 .legend{background:var(--panel);border-bottom:1px solid var(--line);
         padding:0 var(--inset);box-shadow:0 1px 0 rgba(15,23,42,.03)}
 .legend th{font:600 11px/1.5 var(--sans);letter-spacing:.06em;color:var(--ink3)}

 /* 表格：fixed 布局 + 七列定宽写在一处。除第 5 列外都定宽，那一列吃余量。
    右边留一道 14px 沟：没有沟时相邻两列的正文会贴在一起（上一轮实测：
    操作列的长 operationId 与说人话那一列黏成一串）。末列不留，让表格右沿与卡片对齐。 */
 .tbl{width:100%;table-layout:fixed;border-collapse:collapse}
 .tbl th,.tbl td{padding:7px 14px 7px 0;text-align:left;vertical-align:top;
                 border-bottom:1px solid var(--line2);overflow-wrap:break-word}
 .tbl th:last-child,.tbl td:last-child{padding-right:0}
 .tbl th{padding-bottom:5px}
 .tbl th:nth-child(1),.tbl td:nth-child(1){width:62px}
 .tbl th:nth-child(2),.tbl td:nth-child(2){width:58px}
 .tbl th:nth-child(3),.tbl td:nth-child(3){width:228px}
 .tbl th:nth-child(4),.tbl td:nth-child(4){width:168px}
 .tbl th:nth-child(6),.tbl td:nth-child(6){width:118px}
 .tbl th:nth-child(7),.tbl td:nth-child(7){width:140px}
 tr:last-child td{border-bottom:0}

 td:nth-child(1){font:11.5px/1.6 var(--mono);color:var(--ink3);white-space:nowrap}
 td:nth-child(2){font:11.5px/1.6 var(--mono);font-weight:700;letter-spacing:.02em;white-space:nowrap}
 td:nth-child(3),td:nth-child(4){font:12.5px/1.5 var(--mono)}
 td:nth-child(3){color:var(--ink2)}
 td:nth-child(5){color:var(--ink2)}
 td:nth-child(6),td:nth-child(7){font-size:12px}
 tr.GET td:nth-child(2){color:var(--ok)}
 tr.POST td:nth-child(2){color:var(--link)}
 tr.PUT td:nth-child(2){color:var(--warn)}
 tr.PATCH td:nth-child(2){color:#7c3aed}
 tr.DELETE td:nth-child(2){color:var(--bad)}
 tr.stale td:nth-child(3){color:var(--warn)}
 tr.noapi td:nth-child(3){color:var(--ink4)}

 .chip{display:inline-block;font:600 11px/1.6 var(--sans);border-radius:5px;
       padding:1px 6px;background:var(--accent);color:var(--accent-ink)}
 .chip.bad{background:var(--bad-bg);color:var(--bad)}
 .mut{font-style:normal;color:var(--ink4)}
 .chip+.chip{margin-left:4px}

 /* 卡与分段 */
 .wrap{padding:0 var(--pad-page) 56px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
       margin:12px 0;overflow:hidden}
 .card>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
              padding:11px var(--pad-card) 0}
 .card h2{margin:0;font-size:15px;font-weight:650;letter-spacing:-.005em}
 .dir{color:var(--ink4)}
 .cnt{margin-left:auto;color:var(--ink3);font-size:12px;font-variant-numeric:tabular-nums}
 .bk{display:flex;flex-wrap:wrap;gap:3px 14px;margin:6px 0 0;
     padding:0 var(--pad-card) 11px;border-bottom:1px solid var(--line2)}
 .bk span{font-size:11.5px;color:var(--ink3)}
 .bk b{font-weight:650;color:var(--ink);font-variant-numeric:tabular-nums}
 .bk .ok b{color:var(--ok)} .bk .warn b{color:var(--warn)}
 .bk .z,.bk .z b{color:var(--ink4);font-weight:400}
 .sec{padding:0 var(--pad-card)}
 .sec h3{display:flex;align-items:center;gap:7px;margin:15px 0 3px;
         font:600 12px/1.5 var(--sans);letter-spacing:.02em;color:var(--ok)}
 .sec h3::before{content:"";width:7px;height:7px;border-radius:2px;background:currentColor}
 .sec h3.warn{color:var(--warn)} .sec h3.dim{color:var(--ink3)}
 .sec .note{margin:2px 0 8px}
 .note{color:var(--ink3);font-size:13px;margin:6px var(--pad-card) 12px}
 /* 汇总条：它是一段说明，不是警告 —— 上一版用琥珀色，抢在卡片前面。
    改成中性底 + 一条细的左侧标尺，层级交给数字的字重。 */
 .sum{padding:11px 16px;background:var(--panel2);color:var(--ink2);
      border-bottom:1px solid var(--line);border-left:3px solid var(--ink4);font-size:13px}
 .sum b{color:var(--ink);font-weight:650}
 .sum code{color:var(--ink3)}

 /* 窄屏：七列排不下就竖排，列名由 CSS 生成（行里不带 data- 属性，省下 13KB）。 */
 @media (max-width: 900px){
  :root{--pad-page:12px;--pad-card:12px}
  .legend{display:none}
  .hl-bar .now{display:none}
  .tbl,.tbl tbody,.tbl tr,.tbl td{display:block;width:auto}
  /* 定宽那几条是 .tbl td:nth-child(3)（0,2,1），width:auto 压不住它 —— 竖排时必须
     用同级的 :nth-child(n) 覆盖，否则格子还是桌面宽度，标签与值会挤在 56px 里溢出去。 */
  .tbl th:nth-child(n),.tbl td:nth-child(n){width:auto}
  .tbl tr{padding:8px 0;border-bottom:1px solid var(--line2)}
  .tbl td{border:0;padding:0}
  .tbl td:empty{display:none}
  .tbl td::before{content:"";display:inline-block;width:76px;color:var(--ink4);
                  font:600 11px/1.7 var(--sans);letter-spacing:.04em;vertical-align:top}
  td:nth-child(1)::before{content:"状态"} td:nth-child(2)::before{content:"方法"}
  td:nth-child(3)::before{content:"路径"} td:nth-child(4)::before{content:"操作"}
  td:nth-child(5)::before{content:"说人话"} td:nth-child(6)::before{content:"触发"}
  td:nth-child(7)::before{content:"缺口"}
 }
 @media (prefers-reduced-motion: no-preference){ html{scroll-behavior:smooth} }
</style></head><body>
<div class="top">
<div class="hl-bar">化龙 API · <b>按屏幕看</b>
  <a href="${homeUrl}">按模块看（Swagger UI）</a>
  <a href="${rolesUrl}">角色矩阵</a>
  <a href="${specUrl}">按屏幕看的规格</a>
  <a href="${rawUrl}">原始 YAML</a>
  ${rawViewerUrl ? `<a href="${rawViewerUrl}">原文（HTML，中文不乱码）</a>` : ''}
  ${specViewerUrl ? `<a href="${specViewerUrl}">按屏幕的规格（HTML，中文不乱码）</a>` : ''}
  <span class="now">一屏一卡 · 分段计数 · 0 也写出来</span>
</div>
<div class="legend"><table class="tbl"><thead><tr>${HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead></table></div>
</div>
<div class="wrap">
<div class="sum">
 教师端 <b>${byScreen.size}</b> 屏有记录（共 ${screenOps.length} 条）。
 其中 <b>${nNotCalled}</b> 屏有「契约有、这一屏没调」的行，<b>${nNeedsApi}</b> 屏有「契约还没有」的行。
 契约里教师可达但<b>没有任何页面调用</b>的操作：<b>${unused.length}</b> 条（列在文末）。
 非教师角色（家长端／管理端）的操作 <b>${notTeacher.length}</b> 条，本轮不映射它们的屏幕。
</div>
${cards}
<section class="card" id="unused">
  <header><h2>无人认领的操作</h2><code class="dir">契约里有、客户端一处都没调</code><span class="cnt">${unused.length} 条</span></header>
  <div class="sec">
    <p class="note">判据分两层：<b>service 层也没写</b> = 客户端一处都没有；<b>service 层写了、没有页面走得到</b> = 有导出函数但没有任何页面调到它。两者要修的东西不一样。
    ${serviceReport ? `这一列取自 <code>docs/audit/${esc(serviceReport)}</code>。` : '<b>没读到 <code>docs/audit/</code> 下的接线报告，这一列不猜。</b>'}</p>
    <table class="tbl"><thead><tr>
      <th>状态</th><th>方法</th><th>路径</th><th>操作</th><th>说人话</th><th>service 层</th><th>链接</th>
    </tr></thead><tbody>${unusedRows}</tbody></table>
  </div>
</section>
</div>
</body></html>`;
}
