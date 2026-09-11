/**
 * `/pages` —— 按屏幕看的表页。一屏一卡。**这一页就是唯一那一页**（`/review` 已并进来）。
 *
 * ## 卡里有四种东西，每一种都能留结论与留言
 *
 *   1. **屏幕行**   这一屏整体。点得到原型 `screens/<屏>.html`
 *   2. **意圖行**   原型标记的意圖 ↔ 客户端实际调的操作，并排。
 *                  join 只有一份：`tools/lib/intent-join.mjs`（终端机那支样本也 import 它）
 *   3. **API 行**   七列（状态 方法 路径 操作 说人话 触发 缺口）。**语义一个字没改**
 *   4. **发现**     这一屏的 findings：中文一句（一个 kind 一句，见 `tools/lib/finding-eli10.tsv`）
 *                  + 英文原文照留（机器产生的，以后要 grep）。不属于任何屏的摆去页尾一区
 *
 * 为什么并成一页：用户 2026-09-12 的原话是「我以为係摆埋一齐嘅喎」、
 * 「点解会突然生咗一个新页面出嚟」。从前 `/review` 是另一页，只印英文散文、没有任何预览，
 * 另一位开发（linem7）看不懂 —— 那一页现在没了，`/review` 只回 302 转来这里。
 *
 * ## 留结论走哪条路
 *
 * 一行就是一条 `key`，结论存进 `docs/audit/checker-feedback.tsv`（`tools/lib/feedback.mjs`
 * 是唯一读写它的人）。**不新写路由**：读走既有的 `GET /feedback`，写走既有的 `POST /feedback`。
 * 六个选项在伺服器端由 `STATUS_VALUES` 画出（不另抄一份），已存的结论同时填回去 ——
 * 没有 JS 也看得到、也填得上，人就不会重复判。
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
 * 意圖表是**另一张表**（`.itbl`，两列），列身份与七列表不同源，所以取另一个类名 ——
 * 两张表共用 `.tbl` 会让意圖表的第一列吃到「状态」的 62px 与窄屏标签。
 *
 * ## 表头
 *
 * 每张表自带一行 `<thead>`（模块下的 `THEAD`）。上一版是页面顶部一条 sticky 图例，
 * 已删。它有两个毛病：①只有桌面看得见 —— 窄屏的列名是 `td::before` 另生成的一套；
 * ②**它会对文末两张表说错列名**：「无人认领的操作」是「… service 层 链接」、
 * 「由 utils 内部调用」的末列是「由 utils 调」，图例却一律写「触发／缺口」。
 * 列名跟着表走，才不会说错；窄屏把 `<thead>` 隐藏，只留 `td::before` 那一套。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPageView } from '../lib/screen-ops-data.mjs';
import { joinAll } from '../lib/intent-join.mjs';
import { KIND_ZH, kindZh, LAYER_ZH, SEV_ZH } from '../lib/finding-eli10.mjs';
import { readFeedback, STATUS, STATUS_VALUES } from '../lib/feedback.mjs';
import { navBar } from './nav.mjs';

// 从模块位置推仓根，不用 process.cwd() —— 那要看谁从哪里起服务，太脆。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

/** 七列。列名只在这里写一份 —— 每张表自带的一行 `<thead>` 用它。 */
const HEAD = ['状态', '方法', '路径', '操作', '说人话', '触发', '缺口'];

/**
 * 每张表自带的一行表头。
 *
 * 上一版只有顶部一条 sticky 图例。它有两个毛病：①只有桌面看得见，窄屏的列名靠 `td::before`
 * 另生成一套；②**它对文末两张表说错了列名** ——「无人认领的操作」是
 * `状态 方法 路径 操作 说人话 service 层 链接`、「由 utils 内部调用」的末列是「由 utils 调」，
 * 而图例一律写「触发／缺口」。表头回到表上，就跟着表走。
 *
 * 列宽不靠这里：宽度仍是 `.tbl th/td:nth-child(n)` 一处写死，`table-layout:fixed`
 * 让每张表的首行（就是这一行 `<thead>`）定下七列轨道，于是各表逐列等宽。
 */
const THEAD = `<thead><tr>${HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;

/** Swagger UI 的深链（`deepLinking` 已开）：`#/<tag>/<operationId>`。 */
const swaggerHref = (op) => `/#/${esc((op.tags || [])[0] || '')}/${esc(op.operationId)}`;

/**
 * 一行「操作」的结论 / 留言控件。
 *
 * **六个选项一份也不抄。** `STATUS_VALUES` 与 `STATUS` 都来自 `tools/lib/feedback.mjs`，
 * 与读写那份 tsv 的是同一份词表 —— 抄一份就会漂，而漂了没人会知道。
 *
 * 已存的结论**在伺服器端**填回去（`selected` + `value` + 已判人／日期），
 * 不是等浏览器 fetch 回来再填：这样即使脚本没跑，人也看得到「这条判过了」。
 */
function verdictInner(saved, links) {
  const opts = ['<option value="">（未审）</option>']
    .concat(STATUS_VALUES.map((v) => `<option value="${esc(v)}"${saved && saved.status === v ? ' selected' : ''}>${esc(v)} — ${esc(STATUS[v] || '')}</option>`))
    .join('');
  // 未审时那一段留空：下拉里的「（未审）」已经说了同一件事，再说一遍只是噪音。
  const state = saved
    ? `<span class="saved">已判</span> <span class="mut">${esc(saved.reviewer)} ${esc(saved.updated_at)}</span>`
    : '';
  return '<span class="vk">留结论</span>'
    + `<select class="st" aria-label="结论（必选）">${opts}</select>`
    + `<input class="nt" aria-label="理由" placeholder="理由（一句）" value="${esc(saved ? saved.note : '')}">`
    + '<button class="sv" type="button">保存</button>'
    + `<span class="res">${state}</span>`
    + links.map((l) => `<a class="see" href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
}

/**
 * 只读版：静态发布站（没有 `/feedback` 路由）上，这一行**不画按了会失败的按钮**，
 * 只把已存的结论与「回本机留」这句话写出来。
 */
function verdictReadOnly(saved, links) {
  const state = saved
    ? `<span class="saved">已判 ${esc(saved.status)}</span> <span class="mut">${esc(saved.note || '（无理由）')} · ${esc(saved.reviewer)} ${esc(saved.updated_at)}</span>`
    : '<i class="mut">未审</i>';
  return '<span class="vk">结论</span>' + state
    + '<span class="noreview">（这一份是静态发布版：没有 /feedback 路由，回本机 npm run swagger 的 /pages 才能留）</span>'
    + links.map((l) => `<a class="see" href="${esc(l.href)}">${esc(l.label)}</a>`).join('');
}

/** 表格里的一行控件：跨满这一张表的列数。 */
const vRow = (canWrite, key, saved, links, cols) => `<tr class="vtr" data-key="${esc(key)}"><td colspan="${cols}">`
  + (canWrite ? verdictInner(saved, links) : verdictReadOnly(saved, links)) + '</td></tr>';

/** 表格外的一行控件（发现用）。 */
const vDiv = (canWrite, key, saved, links = []) => `<div class="vrow" data-key="${esc(key)}">`
  + (canWrite ? verdictInner(saved, links) : verdictReadOnly(saved, links)) + '</div>';

/**
 * 一行七列。一列只干一件事：`操作` 列是标识（operationId，唯一可点的那处），`说人话` 列是解释。
 * 两样合在一格是上一版的毛病 —— 30–60 字的解释把标识挤成了脚注。
 *
 * 一格 0 条时**留空格子**，不写「—」：这一列本来就没有东西可指，写个占位符只是噪音。
 */
function opRow(r, opById, eli10) {
  const op = r.operation_id ? opById.get(r.operation_id) : null;
  const href = op ? swaggerHref(op) : '';
  const name = r.source === 'off-contract' ? '（契约里没有）' : r.operation_id || '（契约还没有）';
  const why = (eli10.get(r.operation_id) || eli10.get(r.key) || {})['幹嘛'] || '';
  const trig = r.trigger_wxml ? esc(r.trigger_wxml) : '<i class="mut">随页面加载</i>';
  const flag = r.trigger_flag ? `<b class="chip">${esc(r.trigger_flag)}</b>` : '';
  const gap = r.gap ? `<b class="chip bad">${esc(r.gap)}</b>` : '';
  const cls = `r${r.method ? ` ${r.method}` : ''}${r.source === 'stale' ? ' stale' : r.source === 'no-api' ? ' noapi' : ''}`;
  return `<tr class="${cls}">`
    + `<td>${r.state ? esc(r.state) : '<i class="mut" title="信号不明确，故留空 —— 不是漏填">—</i>'}</td>`
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
    // 客户端调了、契约里没有。生成器原先把这批静默丢掉，于是这一桶恒为 0 而看不出是空还是坏；
    // 实测有一条真的（`utils/auth.js` 的 `POST /dev/session`）。
    offContract: rows.filter((r) => r.source === 'off-contract'),
    noApi: rows.filter((r) => r.source === 'no-api'),
    stale: rows.filter((r) => r.source === 'stale'),
  };
}

/** 五段的名字与色调。分段表与卡头计数条共用一份，两处不会漂开。 */
const SEGMENTS = [
  ['impl', '已实作', 'ok'],
  ['notCalled', '契约有、这一屏没调', 'warn'],
  ['needsApi', '页面要用而契约没有', 'warn'],
  ['offContract', '契约里没有这条路径', 'bad'],
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
 * 一行在 tsv 里的名字（`key`）—— 结论就存在这个名字下。
 *
 * 形状照既有的 38 条来：`<层>:<种类>:<主体>`（例 `contract:stale-expectation:/training/home`、
 * `cover:stale-expectation:index.html`）。三种行各有各的层与种类：
 *
 *   `screen:card:<屏>`                    屏幕行
 *   `op:row:<屏>/<操作>`                   API 行（没有 operationId 的行用 `方法 路径` 或 source 顶上）
 *   `intent:join:<屏>/<意圖>`              意圖行
 *
 * 主体里不放句子、不放数字（除了「这一屏没配对到意圖」那一种位置式的兜底），
 * 换了数字就换了一行，人的结论不该跟着数字走。
 */
const keyOfScreen = (screen) => `screen:card:${screen}`;
const keyOfOpRow = (r) => `op:row:${r.screen}/${r.operation_id || `${r.method || 'NONE'} ${r.path || r.source}`}`;
const keyOfIntent = (screen, pair, i) => (pair.intent
  ? `intent:join:${screen}/${pair.intent.id}`
  // 操作比意圖多时（意圖表右边多出来的那几行）没有意圖可挂，用位置兜底。
  : `intent:join:${screen}/（无意图）#${i}`);

/** 最新的一份检测报告。不按日期拼档名 —— 拼错了会静默降级成错的一列。 */
function latestReport(reportDir) {
  if (!existsSync(reportDir)) return null;
  const f = readdirSync(reportDir).filter((x) => x.endsWith('.json')).sort().pop();
  if (!f) return null;
  try {
    return { file: f, data: JSON.parse(readFileSync(join(reportDir, f), 'utf8')) };
  } catch (err) {
    return { file: f, data: null, error: String(err.message) };
  }
}

/**
 * 一条发现属于哪一屏。判据是它的 `subject`（稳定主体，见 `.claude/.../lib/findings.mjs`）：
 *
 *   `screens/<屏>.html` · `<屏>.html` · `miniprogram/pages/<屏>/…` · `<屏>` 本身
 *
 * 配不上任何一屏的（例 `mock-alignment`、`coverage-hualong-teacher` 这种整个客户端的）
 * 回空字符串 —— 摆去页尾那一区。**不硬塞**：塞进某一屏的卡里会让人以为它只关乎那一屏。
 */
function screenOfFinding(f, screenNames) {
  const s = (f.subject ?? '').trim();
  if (!s) return '';
  const cand = [
    s.match(/^screens\/([^/]+)\.html$/),
    s.match(/^([^/]+)\.html$/),
    s.match(/^miniprogram\/pages\/([^/]+)\//),
    s.match(/^([a-z0-9-]+)$/),
  ].find(Boolean);
  const name = cand ? cand[1] : '';
  return name && screenNames.has(name) ? name : '';
}

/**
 * 一条发现的版面。**中文一句在前，英文原文照留在旁** ——
 * 中文来自 `kind` 那一行（一个 kind 一句，查 `tools/lib/finding-eli10.tsv`），
 * 英文是机器产生的，不可删：以后有人要 grep `stale-expectation` 这种词。
 * 两段写在同一行里 —— 中间隔一行也算「旁边」，但同一行不用读者自己去找。
 */
function findingBlock(f, saved, prototypeLink, canWrite) {
  const sev = SEV_ZH[f.severity] || f.severity;
  const zh = kindZh(f.kind);
  const links = prototypeLink ? [{ href: prototypeLink, label: '看原型' }]
    : [{ href: '/openapi.yaml', label: '看原始契约' }];
  return `<article class="fd ${esc(f.severity)}">`
    + `<div class="fd-h">`
    + `<b class="sev ${esc(f.severity)}">${esc(sev)}</b>`
    + `<span class="lab">检测层</span><code>${esc(f.layer)}</code>`
    + `<span class="mut">${esc(LAYER_ZH[f.layer] || '（这一层还没有中文）')}</span>`
    + `<span class="lab">种类</span><code>${esc(f.kind)}</code>`
    + `<span class="lab">主体</span><code>${esc(f.subject || '（无主体，不可判）')}</code>`
    + `</div>`
    + `<p class="fd-zh"><span class="lab">中文</span>${zh ? esc(zh) : '<b class="bad">这一种 kind 还没有中文 —— 补 tools/lib/finding-eli10.tsv</b>'}</p>`
    + `<p class="fd-en"><span class="lab">原文（机器产生，留着 grep）</span><span class="en">${esc(f.what)}</span></p>`
    + (f.detail ? `<details><summary>细节（机器原文）</summary><pre>${esc(f.detail)}</pre></details>` : '')
    + `<div class="fd-k"><span class="lab">结论存在这个名字下</span><code>${esc(f.key || '（无 key，不可判）')}</code></div>`
    + (f.key ? vDiv(canWrite, f.key, saved, links) : '<p class="note">这一条没有稳定主体，所以不能承结论 —— 给它一个 subject 就能判。</p>')
    + '</article>';
}

/**
 * `navUrls` 是这一页能到达的全部目的地（键 → 网址），三个路由传的是同一组。
 *
 * @param {{navUrls: object, extra?: Array, omit?: string[],
 *          canWrite?: boolean}} links
 *   `canWrite` 静态发布站传 false：那边没有 `/feedback` 路由，写了也存不下去 ——
 *   与其画一个按了会静默失败的按钮，不如把这一件事写在页面上。
 */
export function pagesPage({ navUrls, omit = [], extra = [], canWrite = true }) {
  const { screenOps, byScreen, eli10, opById, titles, titleInfo, unused, notTeacher, unusedNoService, serviceReport, utilsCalled } = buildPageView();

  // ── 结论：已存的**填回去**，不然人会重复判 ──────────────────────────────
  // 读不了就把这件事画在页面上（不静默留白，也不让整页打不开）。
  let saved = new Map();
  let savedError = '';
  try {
    saved = readFeedback();
  } catch (err) {
    savedError = String(err.message);
  }
  const pick = (key) => saved.get(key) || null;

  // ── 意圖 ↔ 操作：join 只有一份（tools/lib/intent-join.mjs） ──────────────
  const { joins, totalIntents, totalOps } = joinAll([...byScreen.keys()]);

  // ── 发现：一份报告，按主体分到各屏的卡里 ────────────────────────────────
  // 报告不按日期拼档名（拼错了会静默读成另一份），取 `tools/.report/api-test/` 最新那一份。
  const report = latestReport(join(REPO, 'tools', '.report', 'api-test'));
  const reportFindings = report && report.data && Array.isArray(report.data.findings) ? report.data.findings : [];
  const screenNames = new Set(byScreen.keys());
  const screenFindings = new Map();
  for (const f of reportFindings) {
    const s = screenOfFinding(f, screenNames);
    if (!s) continue;
    if (!screenFindings.has(s)) screenFindings.set(s, []);
    screenFindings.get(s).push(f);
  }
  const globalFindings = reportFindings.filter((f) => !screenOfFinding(f, screenNames));

  const cards = [...byScreen.keys()].sort().map((screen) => {
    const rows = byScreen.get(screen);
    const b = bucketOf(rows);
    const info = titleInfo.get(screen) || {};
    const label = screen === '(utils)' ? 'utils（不经页面）' : titles.get(screen) || screen;
    const dir = screen === '(utils)' ? 'miniprogram/utils/' : `miniprogram/pages/${screen}/`;
    // **原型文件名要印出来。** 用户 2026-09-11 的原话是「對齊我才可以知道是原型的哪個」——
    // 只给小程序目录，读的人没法把这一卡对回原型那一屏；而页名本身取自原型里可见的字
    // （见 `screenTitles()`），两者摆在一起才叫对得上。
    const proto = screen === '(utils)' ? '' : info.protoFile || '';
    const protoHref = proto ? `../${proto}` : '';
    const j = joins.get(screen) || { intents: [], ops: [], pairs: [], tables: '', hasPrototype: false };

    // **每一行都要有一个看得见的、点得到的链接**（用户原话：「佢冇任何嘅预览」）。
    // 指到哪一件事分两种：原型在手就指原型（服务端服务 `/screens/`，点得开）；
    // `(utils)` 这种没有原型的伪屏退回原始契约 —— 不给一个点开是 404 的链接。
    const evidence = protoHref
      ? [{ href: protoHref, label: `看原型 ${proto}` }]
      : [{ href: '/openapi.yaml', label: '看原始契约' }];

    // 1) 屏幕行：这一屏整体。
    const screenRow = `<div class="sec"><h3 class="dim">屏幕行 · 判这一屏</h3>`
      + vDiv(canWrite, keyOfScreen(screen), pick(keyOfScreen(screen)), evidence)
      + '</div>';

    // 2) 意圖行：原型标记的意圖与客户端实际操作并排。
    const intentTable = j.pairs.length
      ? `<div class="sec"><h3 class="dim">意圖 ↔ 操作（原型标记 · 客户端实际调的）</h3>`
        + `<p class="note">意圖 <b>${j.intents.length}</b> 个 · 操作 <b>${j.ops.length}</b> 条`
        + ` · 对得上 <b>${j.matched}</b> · 待配 <b>${j.unpaired}</b> · 纯读（无触发）<b>${j.pureRead}</b>`
        + (j.tables ? ` · 主表 <code>${esc(j.tables)}</code>` : '')
        + `。意圖取自 <code>${esc(j.protoFile)}</code> 的 <code>data-intent</code>，操作取自 <code>screen-operations.tsv</code>；`
        + '两边按**位置**配对，不猜 —— 两边 id 不同源，硬配会造出看着对、其实错的对子。</p>'
        + '<table class="itbl"><thead><tr><th>意圖（原型有标记的）</th><th>操作（客户端实际调的）</th></tr></thead><tbody>'
        + j.pairs.map(({ intent, op, offContract }, i) => {
          const left = intent ? `<code>${esc(intent.id)}</code> <span class="mut">×${intent.n}</span>` : '';
          const right = op
            ? (op.operation_id
              ? `<a href="${swaggerHref(opById.get(op.operation_id) || { operationId: op.operation_id })}">${esc(op.operation_id)}</a>`
                + (offContract ? ' <b class="chip bad">契约外</b>' : '')
              : '<i class="mut">（这条操作没有 operation_id）</i>')
            : '';
          return `<tr class="r${offContract ? ' off' : ''}"><td>${left}</td><td>${right}</td></tr>`
            + vRow(canWrite, keyOfIntent(screen, { intent }, i), pick(keyOfIntent(screen, { intent }, i)), evidence, 2);
        }).join('')
        + '</tbody></table></div>'
      : `<div class="sec"><h3 class="dim">意圖 ↔ 操作</h3>`
        + `<p class="note">${j.hasPrototype ? '这一屏的原型一个 <code>data-intent</code> 都没标记。' : `这一屏没有原型档（<code>${esc(j.protoFile)}</code>），所以没有意圖可看。`}`
        + `操作 <b>${j.ops.length}</b> 条。</p></div>`;

    // 3) API 行：七列一个字没改，每行底下多一条结论 / 留言。
    const body = SEGMENTS.map(([k, title, tone]) => {
      const list = b[k];
      if (!list.length) return '';
      const table = `<table class="tbl">${THEAD}<tbody>`
        + list.map((r) => opRow(r, opById, eli10)
          + vRow(canWrite, keyOfOpRow(r), pick(keyOfOpRow(r)), evidence, 7)).join('')
        + '</tbody></table>';
      if (k === 'noApi') {
        return `<div class="sec"><h3 class="${tone}">${title}</h3>`
          + `<p class="note">${esc(list.map((r) => r.notes).join('；'))}</p>`
          + `${table}</div>`;
      }
      if (k === 'offContract') {
        return `<div class="sec"><h3 class="${tone}">${title}</h3>` + table
          + '<p class="note">客户端真的在调，契约里没有这条路径。生成器原先把它静默丢掉 —— 于是这一桶永远是 0，而看不出是空还是坏。</p></div>';
      }
      return `<div class="sec"><h3 class="${tone}">${title}</h3>` + table + '</div>';
    }).join('');

    // 4) 这一屏的发现
    const mine = screenFindings.get(screen) || [];
    const findings = mine.length
      ? `<div class="sec"><h3 class="bad">这一屏的发现 <b>${mine.length}</b> 条</h3>`
        + mine.map((f) => findingBlock(f, pick(f.key), protoHref, canWrite)).join('') + '</div>'
      : '';

    return `<section class="card" id="s-${esc(screen)}">`
      + `<header><h2>${esc(label)}</h2>`
      + `<code class="dir">${esc(dir)}</code>`
      + (proto ? `<code class="proto" title="页名取自这一份原型里可见的字">原型 <a href="${protoHref}">${esc(proto)}</a></code>` : '')
      + (proto ? '' : '<code class="proto muted" title="这一屏还没有原型">无原型</code>')
      + `<span class="cnt">${rows.length} 条</span></header>`
      + countStrip(b)
      + screenRow
      + intentTable
      + (body || '<p class="note">这一屏没有任何记录，且不是 no-api —— 是一个缺口（缺行与「本来就没有」必须分得开）。</p>')
      + findings
      + '</section>';
  }).join('\n');

  const nNeedsApi = [...byScreen.values()].filter((rows) => bucketOf(rows).needsApi.length > 0).length;
  const nNotCalled = [...byScreen.values()].filter((rows) => bucketOf(rows).notCalled.length > 0).length;

  // 页尾那张「无人认领」也每一行能留结论 —— 它同样是一条一条的操作。
  const unusedRows = unused.map((o) => {
    const why = (eli10.get(o.operationId) || {})['幹嘛'] || '';
    const verdict = !serviceReport ? '<i class="mut">没读到裁决报告</i>'
      : unusedNoService.has(o.path) ? '<b class="chip bad">service 层也没写</b>'
        : 'service 层写了，没有页面走得到';
    return `<tr class="r${o.method ? ` ${o.method}` : ''}">`
      + '<td></td>'
      + `<td>${esc(o.method)}</td>`
      + `<td>${escPath(o.path)}</td>`
      + `<td>${esc(o.operationId)}</td>`
      + `<td>${esc(why)}</td>`
      + `<td>${verdict}</td>`
      + `<td><a href="${swaggerHref(o)}">看操作说明</a></td>`
      + '</tr>'
      + vRow(canWrite, `op:unused:${o.operationId}`, pick(`op:unused:${o.operationId}`), [{ href: swaggerHref(o), label: '看操作说明' }], 7);
  }).join('');

  const nav = navBar({
    current: 'pages',
    urls: navUrls,
    omit,
    title: '按屏幕看',
    extra,
    note: '一屏一卡 · API 行 + 意圖行 + 发现 · 每一行都能留结论 · 「说人话」机器交叉核过、无人逐条读过',
  });

  // ── kind → 中文 的对照表：17 种全部列出来，0 条也列 ─────────────────────
  // 这一区是给读的人核对用的：页面上每一条发现的中文都从那 17 句里来。
  const kindCount = new Map();
  for (const f of reportFindings) kindCount.set(f.kind, (kindCount.get(f.kind) || 0) + 1);
  const kindTable = [...KIND_ZH].map(([k, zh]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(zh)}</td>`
    + `<td class="num">${kindCount.get(k) || 0}</td></tr>`).join('');


  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>化龙 API · 按屏幕看（API 行 + 意圖行 + 发现，每一行可留结论）</title>
<style>
 /* 一份 token：只有一套亮色变量，其余规则只认变量名。 */
 :root{
  --bg:#eef5f3; --panel:#fff; --panel2:#f5faf9;
  --ink:#10302d; --ink2:#35564f; --ink3:#55766f; --ink4:#73908a;
  --line:#d5e6e2; --line2:#e7f1ef;
  --link:#0a6472; --accent:#d9f0eb; --accent-ink:#0d5a53;
  --ok:#0b7a4b; --warn:#9a5a06; --violet:#6b4fa8;
  --bad:#ad2b2b; --bad-bg:#fde8e6;
  --mono:ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  --sans:system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --pad-page:16px; --pad-card:14px;
 }
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 var(--sans);
      -webkit-text-size-adjust:100%}
 a{color:var(--link);text-decoration:none}
 a:hover{text-decoration:underline}
 code{font:12.5px/1.4 var(--mono)}

 /* 顶栏 + 图例共用一个 sticky 容器 —— 两截贴顶时不用猜顶栏高度。 */
 .top{position:sticky;top:0;z-index:9}
 /* 顶栏的样式跟着顶栏走：唯一一份在 tools/swagger/nav.mjs，三个页面共用。这里不再写第二份。 */

 /* 表头：每张表自带一行。上一版是顶部一条 sticky 图例 —— 它只在桌面显示，
    而且「无人认领的操作」与「由 utils 内部调用」两张表的列跟它不同（那两张写的是
    service 层／链接），滚到那里图例上的列名就是错的。表头回到表上，就不会说错。 */

 /* 表格：fixed 布局 + 七列定宽写在一处。除第 5 列外都定宽，那一列吃余量。
    右边留一道 14px 沟：没有沟时相邻两列的正文会贴在一起（上一轮实测：
    操作列的长 operationId 与说人话那一列黏成一串）。末列不留，让表格右沿与卡片对齐。 */
 .tbl{width:100%;table-layout:fixed;border-collapse:collapse}
 .tbl th,.tbl td{padding:7px 14px 7px 0;text-align:left;vertical-align:top;
                 border-bottom:1px solid var(--line2);overflow-wrap:break-word}
 .tbl th:last-child,.tbl td:last-child{padding-right:0}
 .tbl th{padding-bottom:5px}
 /* 表头是每张表自己的一行。列名只有一份（模块下的 THEAD），card 与 card 之间不会漂开。 */
 .tbl thead th{font:600 11px/1.5 var(--sans);letter-spacing:.06em;color:var(--ink3);
               white-space:nowrap;border-bottom:1px solid var(--line)}
 .tbl th:nth-child(1),.tbl td:nth-child(1){width:62px}
 .tbl th:nth-child(2),.tbl td:nth-child(2){width:58px}
 .tbl th:nth-child(3),.tbl td:nth-child(3){width:228px}
 .tbl th:nth-child(4),.tbl td:nth-child(4){width:168px}
 .tbl th:nth-child(6),.tbl td:nth-child(6){width:118px}
 .tbl th:nth-child(7),.tbl td:nth-child(7){width:140px}
 .tbl tr:last-child td{border-bottom:0}

 .tbl td:nth-child(1){font:11.5px/1.6 var(--mono);color:var(--ink3);white-space:nowrap}
 .tbl td:nth-child(2){font:11.5px/1.6 var(--mono);font-weight:700;letter-spacing:.02em;white-space:nowrap}
 .tbl td:nth-child(3),.tbl td:nth-child(4){font:12.5px/1.5 var(--mono)}
 .tbl td:nth-child(3){color:var(--ink2)}
 .tbl td:nth-child(5){color:var(--ink2)}
 .tbl td:nth-child(6),.tbl td:nth-child(7){font-size:12px}
 .tbl tr.GET td:nth-child(2){color:var(--ok)}
 .tbl tr.POST td:nth-child(2){color:var(--link)}
 .tbl tr.PUT td:nth-child(2){color:var(--warn)}
 .tbl tr.PATCH td:nth-child(2){color:var(--violet)}
 .tbl tr.DELETE td:nth-child(2){color:var(--bad)}
 .tbl tr.stale td:nth-child(3){color:var(--warn)}
 .tbl tr.noapi td:nth-child(3){color:var(--ink4)}

 /* 意圖表：两列，列身份与七列表不同源，所以是另一个类名。
    两张表共用 .tbl 会让意圖表的第一列吃到「状态」的 62px 与窄屏标签。 */
 .itbl{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:4px}
 .itbl th,.itbl td{padding:6px 14px 6px 0;text-align:left;vertical-align:top;
                   border-bottom:1px solid var(--line2);overflow-wrap:break-word}
 .itbl th{font:600 11px/1.5 var(--sans);letter-spacing:.06em;color:var(--ink3);
          white-space:nowrap;border-bottom:1px solid var(--line)}
 .itbl th:nth-child(1),.itbl td:nth-child(1){width:44%}
 .itbl td:nth-child(1){font:12.5px/1.5 var(--mono);color:var(--ink2)}
 .itbl td:nth-child(2){font:12.5px/1.5 var(--mono)}
 .itbl tr.off td:nth-child(2){color:var(--warn)}

 .chip{display:inline-block;font:600 11px/1.6 var(--sans);border-radius:5px;
       padding:1px 6px;background:var(--accent);color:var(--accent-ink)}
 .chip.bad{background:var(--bad-bg);color:var(--bad)}
 .mut{font-style:normal;color:var(--ink4)}
 .chip+.chip{margin-left:4px}

 /* ── 留结论的那一条：结论下拉 + 理由输入框 + 保存。三种行共用这一份样式。 ── */
 .tbl tr.vtr>td,.itbl tr.vtr>td{font:13px/1.5 var(--sans);color:var(--ink2);
      white-space:normal;padding:2px 0 9px;border-bottom:1px solid var(--line2)}
 .tbl tr.vtr:last-child>td,.itbl tr.vtr:last-child>td{border-bottom:0}
 .vk{font:600 11px/1.6 var(--sans);letter-spacing:.04em;color:var(--ink4);margin-right:6px}
 .st,.nt{font:12.5px/1.5 var(--sans);color:var(--ink);background:#fff;
         border:1px solid var(--line);border-radius:5px;padding:3px 6px}
 .st{max-width:28em}
 .nt{width:min(30em,45vw);margin:0 6px}
 .sv{font:12.5px/1.5 var(--sans);background:var(--link);color:#fff;border:0;
     border-radius:5px;padding:4px 12px;cursor:pointer}
 .sv:hover{background:var(--accent-ink)}
 .res{margin-left:8px;font-size:12px}
 .saved{color:var(--ok);font-weight:650}
 .see{margin-left:10px;font-size:12px;white-space:nowrap}
 .see::before{content:"↗ ";opacity:.6}
 .vrow{margin:2px 0 10px}
 .noreview{color:var(--ink3);font-size:12.5px}

 /* ── 发现 ── */
 .fd{border:1px solid var(--line2);border-left:3px solid var(--ink4);border-radius:8px;
     padding:9px 11px;margin:9px 0;background:var(--panel2)}
 .fd.high{border-left-color:var(--bad)} .fd.medium{border-left-color:var(--warn)}
 .fd-h{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
 .sev{display:inline-block;font:600 11px/1.6 var(--sans);border-radius:5px;padding:1px 7px}
 .sev.high{background:var(--bad-bg);color:var(--bad)}
 .sev.medium{background:#fdf3e3;color:var(--warn)}
 .sev.low{background:#eef5f3;color:var(--ink3)}
 .lab{font:600 11px/1.6 var(--sans);letter-spacing:.04em;color:var(--ink4);margin-right:5px}
 .fd p{margin:5px 0}
 .fd .en{color:var(--ink2);font:12.5px/1.5 var(--mono)}
 .fd pre{white-space:pre-wrap;font:12px/1.5 var(--mono);color:var(--ink2);margin:4px 0 0}
 .fd summary{color:var(--ink3);font-size:12px;cursor:pointer}
 .fd-k code{word-break:break-all}

 /* 卡与分段 */
 .wrap{padding:0 var(--pad-page) 56px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
       margin:12px 0;overflow:hidden}
 .card>header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;
              padding:11px var(--pad-card) 0}
 .card h2{margin:0;font-size:15px;font-weight:650;letter-spacing:-.005em}
 .dir{color:var(--ink4)}
 .proto{color:var(--ink4)}
 .proto a{color:var(--ink4)}
 .proto.muted{opacity:.55;font-style:italic}
 .proto::before{content:"· ";opacity:.5}
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
 .sec h3.warn{color:var(--warn)} .sec h3.dim{color:var(--ink3)} .sec h3.bad{color:var(--bad)}
 .sec .note{margin:2px 0 8px}
 .note{color:var(--ink3);font-size:13px;margin:6px var(--pad-card) 12px}
 table.kinds{border-collapse:collapse;margin:2px 0 10px}
 table.kinds td{text-align:left;padding:4px 14px 4px 0;border-bottom:1px solid var(--line2);
                vertical-align:top;font-size:13px}
 table.kinds td.num{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink3)}

 /* 判的人：整页一个名字，判断要署名。 */
 .who{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;
      padding:11px 16px;background:var(--panel2);border-bottom:1px solid var(--line);
      border-left:3px solid var(--ink4);font-size:13px;color:var(--ink2)}
 .who input{font:13px/1.5 var(--sans);color:var(--ink);background:#fff;
            border:1px solid var(--line);border-radius:5px;padding:4px 8px;width:180px}
 .who code{color:var(--ink3)}
 .warnbar{padding:10px 16px;background:var(--bad-bg);color:var(--bad);font-size:13px;
          border-bottom:1px solid var(--line)}
 /* 汇总条：它是一段说明，不是警告 —— 上一版用琥珀色，抢在卡片前面。
    改成中性底 + 一条细的左侧标尺，层级交给数字的字重。 */
 .sum{padding:11px 16px;background:var(--panel2);color:var(--ink2);
      border-bottom:1px solid var(--line);border-left:3px solid var(--ink4);font-size:13px}
 .sum b{color:var(--ink);font-weight:650}
 .sum code{color:var(--ink3)}

 /* 窄屏：七列排不下就竖排，列名由 CSS 生成（行里不带 data- 属性，省下 13KB）。
    意圖表两列也一起竖排，列名用它自己那一套（两张表列名不同源）。 */
 @media (max-width: 900px){
  :root{--pad-page:12px;--pad-card:12px}
  .tbl thead,.itbl thead{display:none}
  .tbl,.tbl tbody,.tbl tr,.tbl td,
  .itbl,.itbl tbody,.itbl tr,.itbl td{display:block;width:auto}
  /* 定宽那几条是 .tbl td:nth-child(3)（0,2,1），width:auto 压不住它 —— 竖排时必须
     用同级的 :nth-child(n) 覆盖，否则格子还是桌面宽度，标签与值会挤在 56px 里溢出去。 */
  .tbl th:nth-child(n),.tbl td:nth-child(n),
  .itbl th:nth-child(n),.itbl td:nth-child(n){width:auto}
  .tbl tr,.itbl tr{padding:8px 0;border-bottom:1px solid var(--line2)}
  .tbl td,.itbl td{border:0;padding:0}
  .tbl td:empty,.itbl td:empty{display:none}
  .tbl td::before,.itbl td::before{content:"";display:inline-block;width:76px;color:var(--ink4);
                  font:600 11px/1.7 var(--sans);letter-spacing:.04em;vertical-align:top}
  .tbl td:nth-child(1)::before{content:"状态"} .tbl td:nth-child(2)::before{content:"方法"}
  .tbl td:nth-child(3)::before{content:"路径"} .tbl td:nth-child(4)::before{content:"操作"}
  .tbl td:nth-child(5)::before{content:"说人话"} .tbl td:nth-child(6)::before{content:"触发"}
  .tbl td:nth-child(7)::before{content:"缺口"}
  .itbl td:nth-child(1)::before{content:"意圖"} .itbl td:nth-child(2)::before{content:"操作"}
  /* 留结论那一行不分列，所以不要给它生成列名。 */
  .tbl tr.vtr>td::before,.itbl tr.vtr>td::before{content:none}
  .tbl tr.vtr,.itbl tr.vtr{border-bottom:0;padding:0 0 9px}
  .nt{width:100%;margin:5px 0}
  .st{max-width:100%;display:block}
 }
 @media (prefers-reduced-motion: no-preference){ html{scroll-behavior:smooth} }
</style></head><body>
<div class="top">
${nav}
</div>
<div class="wrap">
<div class="sum">
 教师端 <b>${byScreen.size}</b> 屏有记录（共 ${screenOps.length} 条）。
 其中 <b>${nNotCalled}</b> 屏有「契约有、这一屏没调」的行，<b>${nNeedsApi}</b> 屏有「契约还没有」的行。
 契约里教师可达但<b>没有任何页面调用</b>的操作：<b>${unused.length}</b> 条（列在文末）。
 非教师角色（家长端／管理端）的操作 <b>${notTeacher.length}</b> 条，本轮不映射它们的屏幕。
 意圖行 <b>${totalIntents}</b> 条 · 卡片里另附 <b>${totalOps}</b> 条操作 · 发现 <b>${reportFindings.length}</b> 条
 （其中 <b>${reportFindings.length - globalFindings.length}</b> 条属于某一屏、<b>${globalFindings.length}</b> 条不分屏，列在文末）。
 检测报告 <code>${esc(report ? report.file : '（还没跑过）')}</code>。
 已存的结论 <b>${saved.size}</b> 条。
</div>
${report && report.error ? `<div class="warnbar">报告读不了：<code>${esc(report.file)}</code> 解析失败（${esc(report.error)}）。这一页照常显示，但<b>没有发现</b>可看。</div>` : ''}
${!report ? `<div class="warnbar">还没有检测报告。<code>tools/.report/api-test/</code> 是空的 —— 先跑一次 <code>node .claude/skills/hualong-api-test/run.mjs</code>。</div>` : ''}
${savedError ? `<div class="warnbar">结论档读不了：<code>${esc(savedError)}</code>。这一页照常显示，但<b>没有回显已存的结论</b> —— 请先修 <code>docs/audit/checker-feedback.tsv</code>。</div>` : ''}
${canWrite ? `<div class="who">
  <label>你的名字 <input id="who" placeholder="写你的 handle，判断要署名"></label>
  <span class="mut">结论存进 <code>docs/audit/checker-feedback.tsv</code>（走既有的 <code>POST /feedback</code>）。</span>
</div>` : `<div class="who"><b>这一份是静态发布版：没有 <code>/feedback</code> 路由。</b>
  <span class="mut">要在本机跑 <code>npm run swagger</code> 打开 /pages 才能留结论。</span></div>`}
${cards}
${globalFindings.length ? `<section class="card" id="findings-global">
  <header><h2>不属任何屏的发现</h2><code class="dir">整个客户端的（契约 / mock / 生成物 / 别的客户端）</code><span class="cnt">${globalFindings.length} 条</span></header>
  <div class="sec">
    <p class="note">这些发现的主体不是一个屏幕（例：<code>mock-alignment</code>、<code>coverage-hualong-teacher</code>），
    硬塞进某一屏的卡里会让人以为它只关乎那一屏，所以单列一区。</p>
    ${globalFindings.map((f) => findingBlock(f, pick(f.key), '', canWrite)).join('')}
  </div>
</section>` : ''}
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
${utilsCalled.length ? `<section class="card" id="utils">
  <header><h2>由 utils 内部调用</h2><code class="dir">miniprogram/utils/</code><span class="cnt">${utilsCalled.length} 条</span></header>
  <div class="sec">
    <p class="note">这几条不挂在任何屏幕上 —— 是 <code>utils/auth.js</code> 直接调的（登录那两发）。没有这一段，按屏幕看的人看不到它们存在：它们既然没有屏调用，就不在任何卡里，而排出了下面那张「无人认领」表。</p>
    <table class="tbl">${THEAD}<tbody>
    ${utilsCalled.map((o) => `<tr class="r">`
      + '<td>—</td>'
      + `<td>${esc(o.method)}</td>`
      + `<td>${escPath(o.path)}</td>`
      + `<td>${esc(o.operationId)}</td>`
      + `<td>${esc((eli10.get(o.operationId) || {})['幹嘛'] || '')}</td>`
      + '<td><i class="mut">随页面加载</i></td>'
      + '<td><b class="chip">由 utils 调</b></td>'
      + '</tr>'
      + vRow(canWrite, `op:utils:${o.operationId}`, pick(`op:utils:${o.operationId}`), [{ href: swaggerHref(o), label: '看操作说明' }], 7)).join('\n    ')}
    </tbody></table>
  </div>
</section>` : ''}
<section class="card" id="kinds">
  <header><h2>发现种类（kind）与中文</h2><code class="dir">一个 kind 一句，共 ${KIND_ZH.size} 种</code><span class="cnt">中文 ${KIND_ZH.size} 句</span></header>
  <div class="sec">
    <p class="note">页面上每一条发现的中文都从这 ${KIND_ZH.size} 句里查（<code>tools/lib/finding-eli10.tsv</code>），
    **不逐条手写** —— 同一种 kind 会出很多条，逐条写就是多一份会过期的副本。
    最右一列是这一份报告里出现了几条；0 表示这一轮没出现，不是没有中文。</p>
    <table class="kinds"><tbody>${kindTable}</tbody></table>
  </div>
</section>
</div>
${canWrite ? `<script>
(function(){
  // 判的人：整页一个名字，存在 localStorage。判断要署名 —— 没署名就分不出谁判的。
  var who = document.getElementById('who');
  if (who) {
    who.value = localStorage.getItem('reviewer') || '';
    who.addEventListener('change', function(){ localStorage.setItem('reviewer', who.value.trim()); });
  }
  // 每一行一个保存钮：读它那一行的三个控件，POST 回既有的 /feedback 路由。
  // 选项与已存的结论都是伺服器端画好的（见 pages-view.mjs 的 verdictInner），
  // 这一支只负责送出去，不抄第二份词表。
  document.querySelectorAll('[data-key] .sv').forEach(function(btn){
    btn.addEventListener('click', function(){
      var box = btn.closest('[data-key]');
      var status = box.querySelector('.st').value;
      var note = box.querySelector('.nt').value.trim();
      var res = box.querySelector('.res');
      var me = who ? (who.value || '').trim() : '';
      if (!status) { res.textContent = '先选一个结论'; return; }
      if (!me) { res.textContent = '先写名字 — 判断要署名'; return; }
      res.textContent = '保存中…';
      fetch('/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: box.dataset.key, status: status, note: note, reviewer: me })
      }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, j: j }; }); })
        .then(function(x){
          if (!x.ok) { res.textContent = '没存上：' + (x.j.error || '?'); return; }
          res.innerHTML = '<span class="saved">已存</span> <span class="mut">' + x.j.row.reviewer + ' ' + x.j.row.updated_at + '</span>';
        })
        .catch(function(e){ res.textContent = '没存上：' + e.message; });
    });
  });
})();
</script>` : ''}
</body></html>`;
}
