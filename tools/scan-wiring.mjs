/**
 * 接线扫描：把「元素 → 事件 → handler → service → 契约」当成一条链，逐环静态比对，
 * 断在哪一环就报哪一环。再反向做一次：契约里教师能调的操作，哪些没有任何 service 用到。
 *
 *   node tools/scan-wiring.mjs            # 写 docs/audit/wiring-<日期>.md / .json / .html
 *   node tools/scan-wiring.mjs --stdout   # 只打印 markdown
 *   node tools/scan-wiring.mjs --selftest # 跑 PRD §6 的三条自测，不扫仓库
 *   node tools/scan-wiring.mjs --emit     # 写 hualong-backend/db/spec 的
 *                                         # screen-operations.tsv 与 operation-eli10.tsv，
 *                                         # 不写审计报告（--emit 与报告是两条路）
 *
 * 审核结论写在 docs/audit/wiring.allowlist.json（PRD 决策 5）。每条发现有一个稳定的 key
 * （`页:层:元素`），命中的规则会填进「结论」列；标 误报 的折叠到报告末尾。
 * .html 是带注释框的检视器：填的结论存在浏览器 localStorage，可导出成 allowlist.json。
 *
 * 六层检查，各自能查出什么、查不出什么：
 *
 *   L1  WXML 的 bind* 与 catch* 指向的 handler 在 Page 里存不存在；存在的话它是
 *       占位（只弹 toast）、只导航、只改本地 data，还是真的碰到了 service。
 *   L2  长得像能点的元素（button／picker／input／hover-class／类名或文案像按钮）
 *       却没有任何事件，自己没有、祖先也没有。判定在 buttonish()，词表按实测校准
 *       （2026-09-09，#8）：244 个带 tap 的节点里认得出 202 个。**剩下 42 个用的是
 *       页面本地一次性类名，全局词表覆盖不到 —— 所以 L2 报 0 条不等于没有漏接的按钮。**
 *   L3  service 里每一次 api.* 调用的路径、动词、action 键、请求体键，逐一对契约。
 *   L4  反向：契约里 x-hualong-roles 含 teacher 的操作，没有任何 service 调过的。
 *   L5  原型 screens/<页>.html 里的按钮文案、事件绑定与跳转，小程序页面里找不到的。
 *   L6  screens.tsv 登记 writes=yes 的页面，却没有任何一条写入调用可达。
 *
 * 查不出的（写在这里，免得把「0 条」读成「没问题」）：元素与事件都没有、原型里也没有
 * 的功能；handler 逻辑写错但确实调了 service 的；渲染问题。前两类只能靠人看
 * 后端 spec 的 method 段与 DO-NOT-BUILD.md，第三类只能在开发者工具里真点。
 *
 * 等级：
 *   确定  机器能证明是缺陷（handler 不存在、路径不在契约、请求体键不在 schema）
 *   高疑  有交互外观却无事件；handler 是占位；writes=yes 却无写入调用
 *   待审  原型有、小程序无；handler 只改本地状态；契约有、客户端未用
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { loadSpec, operations, specPath } from './openapi-source.mjs';
import { emitScreenOperations } from './lib/emit-screen-operations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const MP = join(REPO, 'miniprogram');
const BACKEND = resolve(REPO, '..', 'hualong-backend');
const STDOUT = process.argv.includes('--stdout');
const SELFTEST = process.argv.includes('--selftest');
const EMIT = process.argv.includes('--emit');
const require_ = createRequire(import.meta.url);

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

/**
 * 一页的 WXML 全文 —— 自己的 index.wxml，加上 <import src> 进来的模板。
 *
 * 只读 index.wxml 会把模板里的绑定读成「没有绑定」。成长册三页就是这样：
 * bindtap="onPageTap" 写在 templates/growth-book-page.wxml 里，三页各自 <import> 它，
 * 于是扫描器报三条「handler 定义了没绑」，而翻页本来就是好的。
 * verify-miniprogram.js 的第 4 段早就这样解析，这里用同一套规则。
 */
const readWxml = (dir) => {
  const own = read(join(dir, 'index.wxml'));
  let text = own;
  for (const m of own.matchAll(/<import\s+src=["']([^"']+)["']/g)) {
    const target = m[1].startsWith('/') ? join(MP, m[1].slice(1)) : join(dir, m[1]);
    if (existsSync(target)) text += '\n' + read(target);
  }
  return text;
};

/* ── 页面清单 ─────────────────────────────────────────────────────────────── */

const app = SELFTEST ? { pages: [] } : JSON.parse(read(join(MP, 'app.json')));
const pages = app.pages.map((p) => {
  const name = p.split('/')[1];
  const dir = join(MP, p.replace(/\/index$/, ''));
  const json = existsSync(join(dir, 'index.json')) ? JSON.parse(read(join(dir, 'index.json'))) : {};
  return { name, dir, title: json.navigationBarTitleText || '', route: `/${p}` };
});

/* screens.tsv：原型文件 ↔ 小程序页 ↔ writes 登记 */
const screensTsv = (() => {
  const p = join(BACKEND, 'db', 'spec', 'screens.tsv');
  if (!existsSync(p)) return new Map();
  const lines = read(p).trim().split('\n');
  const head = lines[0].split('\t');
  const out = new Map();
  for (const l of lines.slice(1)) {
    const row = Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? '']));
    const m = /miniprogram\/pages\/([^/]+)\//.exec(row.mp_file || '');
    if (m) out.set(m[1], row);
  }
  return out;
})();

/* ── L1／L2：WXML 解析 ────────────────────────────────────────────────────── */

/** 极简标签流解析：只要能知道每个开标签的属性、行号、祖先链就够了。 */
function parseWxml(text) {
  const src = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const nodes = [];
  const stack = [];
  const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = TAG.exec(src))) {
    const [whole, close, tag, rawAttrs] = m;
    if (close) { stack.pop(); continue; }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w:@.-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const selfClosing = /\/\s*$/.test(rawAttrs) || ['input', 'image', 'icon', 'progress', 'hl-tabbar'].includes(tag);
    // 直接文案：开标签到下一个 < 之间的字
    const after = src.slice(m.index + whole.length);
    const text0 = (after.match(/^([^<]*)/) || ['', ''])[1].replace(/\{\{[^}]*\}\}/g, ' ').trim();
    const node = { tag, attrs, line: lineOf(src, m.index), text: text0, parent: stack[stack.length - 1] || null };
    nodes.push(node);
    if (!selfClosing) stack.push(node);
  }
  return nodes;
}

const EVENT_ATTR = /^(bind|catch|mut-bind|capture-bind|capture-catch):?([a-z]+)$/;
const TAP_EVENTS = new Set(['tap', 'longpress', 'longtap']);
const NATIVE_INTERACTIVE = new Set(['button', 'picker', 'input', 'textarea', 'switch', 'checkbox-group', 'radio-group', 'slider', 'form', 'editor', 'picker-view']);
/* ── L2 的三张词表（2026-09-09 按实测校准，#8）─────────────────────────────
 *
 * 口径：全仓库 247 个带 tap 的节点、103 处 hover-class、btn 家族 37 个类名令牌。
 * 把这 247 个节点的事件当成不存在，逐个跑 buttonish()：现在抓到 202、抓不到 45。
 * 校准前是 156／91。
 *
 * 抓不到的 45 个用的是页面本地一次性类名（image-box、evi-add、rub-toggle、
 * target、option、panel、sheet-mask、add-file、file-pick、input__send、
 * empty__retry、preview__close…）。**那不是词表没调好，是命名本身没有共性**，
 * 全局词表覆盖不到。要闭合只有立「可点元素必须带 hover-class」的约定那一条路。
 *
 * hover-class 是本仓库最干净的信号：103 处，100% 落在已带 tap 的节点上。
 * 所以它当前一条都不报 —— 那是团队真的没漏，不是规则失效。
 */
/** 按钮类名。BEM 子元素靠 ancestorHasTap 兜住，不必进表。 */
const BUTTON_CLASS = /(^|\s)(btn|[a-z0-9-]+-btn|btn-[a-z0-9-]+|[a-z0-9-]+__btn|text-button|lock-button|sbtn|close|remove|trash|download|more|[a-z0-9-]+-more|[a-z0-9-]+__more|file-op|entry-card|link-card|dot-link|sticky-action|add-material|select-all|chip)(--[\w-]+)?(\s|$)/;
/** 容器类名：壳里装着已接线的按钮，壳自己永不算按钮。必须先判它 —— `btn-row` 会命中 BUTTON_CLASS。 */
const CONTAINER_CLASS = /(^|\s)(btn-row|btn-group|btns|action-row|state-actions|sheet-actions|entry-grid|eval-entry-grid|card-list|album-grid|controls|submit-note|upload-note)(--[\w-]+)?(\s|$)/;
/** 无论类名叫什么都是按钮的文案。`.hint`／`.summary__desc` 上有 8 处真的「点此重试」。 */
const ALWAYS_BUTTON_TEXT = /^(点此重试|重试|全选|全部)$/;
/** 按钮文案。团队写的是「动词+宾语」（提交审核、保存草稿、下载Word详案），所以按动词前缀匹配，不是全串精确匹配。 */
const BUTTONISH_TEXT = /^(?:提交|发布|保存|存为|下载|上传|删除|删页|预览|查看|编辑|导出|复制|发送|发给|新增|添加|移除|撤回|撤销|关闭|筛选|搜索|分享|打印|报名|加入|选择|全选|重试|点此|重命名|定稿|提醒|归入|新建|继续|返回|回到|改回|立即|去|取消|确认|确定)[^\s]{0,6}$|^.{0,8}[›»→]$/;
/** 标签类名否决表：同一段文案在 `.btn` 上是按钮、在 `.kicker` 上是标题。只给文案分支用。 */
const NON_BUTTON_WORDS = new Set(['sec', 'title', 'subtitle', 'kicker', 'hint', 'limit', 'label', 'desc', 'note', 'empty', 'body', 'value', 'meta', 'tip', 'caption', 'head', 'legend', 'name', 'count', 'num', 'date', 'time', 'tag', 'badge', 'mark', 'state', 'status', 'summary', 'placeholder', 'banner', 'field', 'chunk', 'form-label', 'sec-head', 'empty-hint', 'sheet-head']);
const looksLikeLabel = (cls) => cls.split(/\s+/).filter(Boolean).some((tok) => tok.split(/__|--/).some((seg) => NON_BUTTON_WORDS.has(seg)));

function eventsOf(attrs) {
  const out = [];
  for (const [k, v] of Object.entries(attrs)) {
    const e = EVENT_ATTR.exec(k);
    if (e) out.push({ attr: k, event: e[2], handler: v });
  }
  return out;
}
function ancestorHasTap(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (eventsOf(p.attrs).some((e) => TAP_EVENTS.has(e.event))) return true;
    if (p.tag === 'navigator' || p.tag === 'form') return true;
  }
  return false;
}
function insideForm(node) {
  for (let p = node.parent; p; p = p.parent) if (p.tag === 'form') return true;
  return false;
}
/** 这个节点有没有把值写回 data 的通道：bindinput／bindchange／model:value／form 里带 name。 */
function hasUpdateChannel(node) {
  if (eventsOf(node.attrs).some((e) => /^(input|change|confirm|blur)$/.test(e.event))) return true;
  if (Object.keys(node.attrs).some((k) => k.startsWith('model:'))) return true;
  if (node.attrs.name !== undefined && insideForm(node)) return true;
  return false;
}
/**
 * 这个节点自身长不长得像能点。**只看节点自身的性质**，不走父链 ——
 * 「祖先带 tap」「navigator 有 url」这两条前置跳过留在调用点。
 * 回 null 表示不像；回 { level, detail } 表示像，level 是发现的等级。
 *
 * 顺序不能换：容器要在按钮类名之前判，否则 `btn-row` 会被 `btn-[a-z0-9-]+` 认成按钮。
 */
function buttonish(node) {
  const cls = node.attrs.class || '';
  if (NATIVE_INTERACTIVE.has(node.tag)) {
    if (node.tag === 'input' && node.attrs.disabled !== undefined) return null;
    // PRD 决策 4：<form bindsubmit> 里带 name 的 input、用 model:value 双向绑定的，都是合法写法
    if (hasUpdateChannel(node)) return null;
    return { level: 'likely', detail: `原生交互控件 <${node.tag}> 没有绑定任何事件` };
  }
  if (node.attrs['hover-class'] !== undefined && node.attrs['hover-class'] !== 'none') {
    return { level: 'likely', detail: '有 hover-class（按下会变色）却没有点击事件' };
  }
  if (CONTAINER_CLASS.test(cls)) return null;
  // 类名分支不要求有直接文案：`<view class="tool-btn"><image/></view>` 是图标按钮，没有文字
  if (BUTTON_CLASS.test(cls)) return { level: 'likely', detail: '类名像按钮，没有点击事件' };
  if (!/^(view|text|button)$/.test(node.tag)) return null;
  if (ALWAYS_BUTTON_TEXT.test(node.text)) return { level: 'review', detail: '文案像按钮，自己与祖先都没有点击事件' };
  if (BUTTONISH_TEXT.test(node.text) && !looksLikeLabel(cls)) {
    return { level: 'review', detail: '文案像按钮，自己与祖先都没有点击事件' };
  }
  return null;
}

/* ── L1：Page 方法 ────────────────────────────────────────────────────────── */

/** 在 vm 里跑 index.js，`Page()` 只记下配置对象；require 到的模块用 Proxy 挡掉。 */
function loadPage(dir) {
  const src = read(join(dir, 'index.js'));
  let captured = null;
  const proxy = () => new Proxy(function () {}, {
    get: (_, k) => {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => '';
      if (k === Symbol.iterator) return function* () {};
      return proxy();
    },
    apply: () => proxy(),
    construct: () => proxy(),
  });
  const sandbox = {
    Page: (o) => { captured = o; },
    Component: (o) => { captured = o.methods || {}; },
    getApp: () => proxy(),
    getCurrentPages: () => [],
    wx: proxy(),
    console,
    module: { exports: {} },
    exports: {},
    require: (p) => {
      // 本页自己的静态数据（题库之类）真加载；其它一律 Proxy
      if (p.startsWith('./')) {
        try { return require_(resolve(dir, p)); } catch { return proxy(); }
      }
      return proxy();
    },
    setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, Number, String, Boolean,
  };
  sandbox.globalThis = sandbox;
  let error = null;
  try {
    vm.runInNewContext(src, sandbox, { filename: join(dir, 'index.js'), timeout: 2000 });
  } catch (e) { error = e.message; }
  const methods = new Map();
  if (captured) {
    for (const [k, v] of Object.entries(captured)) {
      if (typeof v === 'function') methods.set(k, Function.prototype.toString.call(v));
    }
  } else {
    // 兜底：正则抓对象字面量第一层的方法名
    for (const m of src.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
      methods.set(m[1], '/* 正则抓取，无函数体 */');
    }
  }
  const serviceAliases = [...src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(['"](\.\.\/\.\.\/services\/[^'"]+)['"]\)/g)]
    .map((m) => ({ alias: m[1], path: m[2] }));
  // utils／本页静态模块的绑定名：`const viewer = require(...)`、`const { A, B } = require(...)`
  const utilAliases = [];
  for (const m of src.matchAll(/(?:const|let|var)\s+(\{[^}]+\}|\w+)\s*=\s*require\(['"](?!\.\.\/\.\.\/services\/)[^'"]+['"]\)/g)) {
    if (m[1].startsWith('{')) utilAliases.push(...m[1].replace(/[{}]/g, '').split(',').map((s) => s.split(':').pop().trim()).filter(Boolean));
    else utilAliases.push(m[1]);
  }
  return { src, methods, serviceAliases, utilAliases, loadError: error, captured: !!captured };
}

const NAV_RE = /wx\.(navigateTo|redirectTo|switchTab|navigateBack|reLaunch)\b/;
const PLACEHOLDER_RE = /开发中|暂未|尚未开放|未开放|暂不|敬请期待|TODO|本环境不接|尚未接|coming soon/i;
/** 只是提示、不改任何状态的 wx 调用。剩下的 wx.* 都算「做了事」。 */
const UI_ONLY_WX = /\bwx\.(showToast|showModal|showLoading|hideLoading|hideToast|vibrateShort)\b/g;

/**
 * 判定一个 handler 的性质。沿 `this.xxx(` 把本页其它方法的函数体并进来一起看（最多 8 个）。
 *   service  直接或间接调了 services/* 的函数
 *   nav      导航
 *   local    setData／调了 utils 模块／调了会改状态的 wx API
 *   stub     以上都没有 —— 只弹 toast／console／空函数
 */
function classifyHandler(page, name) {
  if (!page.methods.has(name)) return { kind: 'missing' };
  const seen = new Set([name]);
  const queue = [name];
  let union = '';
  while (queue.length && seen.size <= 8) {
    const cur = queue.shift();
    const body = page.methods.get(cur) || '';
    union += `\n${body}`;
    for (const c of body.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (c[1] !== 'setData' && page.methods.has(c[1]) && !seen.has(c[1])) { seen.add(c[1]); queue.push(c[1]); }
    }
  }
  const aliasRe = page.serviceAliases.length
    ? new RegExp(`\\b(${page.serviceAliases.map((a) => a.alias).join('|')})\\.(\\w+)\\s*\\(`)
    : null;
  const placeholder = PLACEHOLDER_RE.test(union);
  // handler 链上读了哪些 this.data.x —— GAP-W 要拿它们去对 WXML 的 value="{{x}}"
  const reads = [...new Set([...union.matchAll(/this\.data\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  if (aliasRe && aliasRe.test(union)) return { kind: 'service', placeholder, reads };
  if (page.serviceAliases.some((a) => new RegExp(`\\b${a.alias}\\[`).test(union))) return { kind: 'service', placeholder, reads };
  if (NAV_RE.test(union)) return { kind: 'nav', placeholder };
  const stripped = union.replace(UI_ONLY_WX, '');
  const utilRe = page.utilAliases.length ? new RegExp(`\\b(${page.utilAliases.join('|')})\\b`) : null;
  if (/\bsetData\s*\(/.test(stripped) || /\bwx\.\w+/.test(stripped) || (utilRe && utilRe.test(stripped)) || /\bthis\.\w+\s*=/.test(stripped)) {
    return { kind: 'local', placeholder };
  }
  const empty = !/[^\s{}()]/.test(union.replace(/^[^{]*\{/, '').replace(/\}\s*$/, ''));
  return { kind: 'stub', placeholder, empty };
}

/* ── L3：service → 契约 ───────────────────────────────────────────────────── */

const spec = loadSpec();
const ops = operations(spec);
/** api/action-registry.tsv：每个动作键的角色、目标表、状态迁移、前置、依据。 */
const actionRegistry = (() => {
  const p = join(BACKEND, 'api', 'action-registry.tsv');
  const out = new Map();
  if (!existsSync(p)) return out;
  const lines = read(p).trim().split('\n');
  const head = lines[0].split('\t');
  for (const l of lines.slice(1)) {
    const row = Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? '']));
    out.set(row.action_key, row);
  }
  return out;
})();
const normalize = (p) => p.replace(/\{[^}]+\}/g, '{*}').replace(/\/+$/, '');
const opIndex = new Map(); // 'GET /trainings/{*}' → op
for (const o of ops) opIndex.set(`${o.method} ${normalize(o.path)}`, o);
const pathSet = new Set(ops.map((o) => normalize(o.path)));

function deref(schema, depth = 0) {
  if (!schema || depth > 6) return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return deref(spec.components?.schemas?.[name], depth + 1);
  }
  if (schema.allOf) {
    const merged = { type: 'object', properties: {}, required: [] };
    for (const part of schema.allOf) {
      const d = deref(part, depth + 1) || {};
      Object.assign(merged.properties, d.properties || {});
      merged.required.push(...(d.required || []));
      if (d.additionalProperties === false) merged.additionalProperties = false;
    }
    return merged;
  }
  return schema;
}
function requestSchema(op) {
  const raw = spec.paths[op.path][op.method.toLowerCase()];
  const s = raw.requestBody?.content?.['application/json']?.schema;
  return s ? deref(s) : null;
}

const VERB = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE', getPage: 'GET', getRoster: 'GET' };

/** 把 `${TASK_PATH}/${taskId}/submissions`、`MOMENT_PATH + '/weekly-coverage'` 之类算成契约形状。 */
function resolvePathExpr(expr, consts) {
  let e = expr.trim();
  if (/^(['"`]).*\1$/s.test(e)) e = e.slice(1, -1);
  // `${X_PATH}` 换常量；`${somethingId}` 是路径参数；其它变量（如按类型挑出来的 path）算不出，记成 {?}
  e = e.replace(/\$\{\s*([\w.]+)\s*\}/g, (_, v) => (consts.has(v) ? consts.get(v) : (/(id|Id|ID|key|Key|code|Code|month|ordinal)$/.test(v) ? '{*}' : '{?}')));
  e = e.replace(/\s*\+\s*['"`]([^'"`]*)['"`]/g, '$1').replace(/^(\w+)\b/, (v) => (consts.has(v) ? consts.get(v) : `{?}`));
  e = e.replace(/\$\{[^}]*\}/g, '{*}');
  return e.startsWith('/') || e.startsWith('{?}') ? e : null;
}

/** 从一次调用的选项对象里抓 body 的键：内联字面量，或本文件里的构造函数一层。 */
function bodyKeys(optsText, fileSrc) {
  const m = /\bbody\s*:\s*([\s\S]*)$/.exec(optsText);
  if (!m) return null;
  const rest = m[1];
  if (rest.startsWith('{')) {
    const inner = balanced(rest, '{', '}');
    return literalKeys(inner);
  }
  const fn = /^(\w+)\s*\(/.exec(rest);
  if (fn) {
    const def = new RegExp(`function\\s+${fn[1]}\\s*\\([^)]*\\)\\s*\\{`).exec(fileSrc);
    if (!def) return null;
    const bodyText = balanced(fileSrc.slice(def.index + def[0].length - 1), '{', '}');
    const keys = new Set(literalKeys(bodyText));
    for (const k of bodyText.matchAll(/\bbody\.(\w+)\s*=/g)) keys.add(k[1]);
    for (const k of bodyText.matchAll(/\bbody\[['"](\w+)['"]\]\s*=/g)) keys.add(k[1]);
    return [...keys];
  }
  return null;
}
function balanced(text, open, close) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(1, i);
  }
  return text;
}
/** 按顶层逗号把实参表切成一段段（引号与括号里的逗号不算）。 */
function splitTop(text) {
  const out = [];
  let depth = 0, start = 0, quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}
/** 调用点所在的函数名。抓不到就 '?'。 */
const fnNameBefore = (s, idx) =>
  ((s.slice(0, idx).match(/function\s+(\w+)\s*\([^)]*\)\s*\{(?![\s\S]*function\s+\w+\s*\([^)]*\)\s*\{)/) || [])[1] || '?');
/** 对象字面量第一层的键。`a: expr, b, ...rest` → [a, b]；值里的标识符不算。 */
function literalKeys(objText) {
  const out = [];
  // 先按顶层逗号切成条目
  const items = [];
  let depth = 0, start = 0, quote = null;
  for (let i = 0; i < objText.length; i++) {
    const ch = objText[i];
    if (quote) { if (ch === quote && objText[i - 1] !== '\\') quote = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if ('{[('.includes(ch)) depth++;
    else if ('}])'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { items.push(objText.slice(start, i)); start = i + 1; }
  }
  items.push(objText.slice(start));
  for (const raw of items) {
    const it = raw.trim();
    if (!it || it.startsWith('...')) continue;
    const m = /^(?:\[[^\]]+\]|'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|$|\()/.exec(it);
    if (m) out.push(m[1] || m[2] || m[3] || '[computed]');
  }
  return [...new Set(out)];
}

function scanService(file) {
  const src = read(file);
  const consts = new Map();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*['"`](\/[^'"`]*)['"`]/g)) consts.set(m[1], m[2]);
  const actionKeys = new Map(); // ACTIONS.register → 'training_participation.register'
  for (const blk of src.matchAll(/const\s+(\w+)\s*=\s*\{([^}]*)\}/g)) {
    for (const kv of blk[2].matchAll(/(\w+)\s*:\s*'([\w.]+)'/g)) actionKeys.set(`${blk[1]}.${kv[1]}`, kv[2]);
  }
  const calls = [];
  const CALL = /\bapi\.(get|post|put|patch|del|getPage|getRoster)\s*\(/g;
  let m;
  while ((m = CALL.exec(src))) {
    const argsText = balanced(src.slice(m.index + m[0].length - 1), '(', ')');
    // 第一个参数：到第一个顶层逗号
    let depth = 0, cut = argsText.length;
    for (let i = 0; i < argsText.length; i++) {
      const ch = argsText[i];
      if ('{[(`'.includes(ch) && ch !== '`') depth++;
      else if ('}])'.includes(ch)) depth--;
      else if (ch === '`') { const j = argsText.indexOf('`', i + 1); i = j < 0 ? argsText.length : j; }
      else if (ch === ',' && depth === 0) { cut = i; break; }
    }
    const pathExpr = argsText.slice(0, cut);
    const optsText = argsText.slice(cut + 1);
    const fnName = fnNameBefore(src, m.index);
    const actionRef = /\baction\s*:\s*([\w.]+|'[\w.]+')/.exec(optsText);
    const action = actionRef ? (actionRef[1].startsWith("'") ? actionRef[1].slice(1, -1) : actionKeys.get(actionRef[1]) || actionRef[1]) : null;
    calls.push({
      line: lineOf(src, m.index), fn: fnName, verb: VERB[m[1]],
      pathExpr: pathExpr.trim(), path: resolvePathExpr(pathExpr, consts),
      action, bodyKeys: /^(post|put|patch)$/.test(m[1]) ? bodyKeys(optsText, src) : null,
    });
  }
  // `api.request('POST', path, opts)` —— 低层出口，登录那一发走的就是它
  // （`utils/auth.js` 的 `POST /auth/session`）。漏掉它，`createSession` 会被判成
  // 「没有任何客户端调用」，交付物里就多一条假发现。
  const RAW = /\bapi\.request\s*\(/g;
  while ((m = RAW.exec(src))) {
    const args = splitTop(balanced(src.slice(m.index + m[0].length - 1), '(', ')'));
    const verb = args.length >= 2 ? /\s*['"]([A-Z]+)['"]\s*/.exec(args[0]) : null;
    if (!verb) continue;
    const optsText = args[2] || '';
    const actionRef = /\baction\s*:\s*([\w.]+|'[\w.]+')/.exec(optsText);
    const action = actionRef ? (actionRef[1].startsWith("'") ? actionRef[1].slice(1, -1) : actionKeys.get(actionRef[1]) || actionRef[1]) : null;
    calls.push({
      line: lineOf(src, m.index), fn: fnNameBefore(src, m.index), verb: verb[1],
      pathExpr: args[1], path: resolvePathExpr(args[1], consts),
      action, bodyKeys: null,
    });
  }
  const exported = [...(src.match(/module\.exports\s*=\s*\{([\s\S]*?)\};/) || ['', ''])[1].matchAll(/^\s*(\w+)\s*[,:]?/gm)].map((x) => x[1]);
  return { file, src, calls, exported: [...new Set(exported)] };
}

/* ── L5：原型 HTML 的交互描述 ─────────────────────────────────────────────── */

function prototypeInteractions(name) {
  const file = join(REPO, 'screens', `${name}.html`);
  if (!existsSync(file)) return null;
  const html = read(file);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([^<]*)/g)]
    .map((m) => ({ text: m[2].replace(/\s+/g, ' ').trim(), attrs: m[1].trim() }))
    .filter((b) => b.text && !/^[×✕‹›]$/.test(b.text) && !/['"+$]/.test(b.text));
  // 排除返回键与底部五个 tab：小程序里前者由导航栏、后者由 hl-tabbar 提供
  const TABBAR = new Set(['home', 'school-affairs', 'comprehensive-coordination', 'training-center', 'home-school']);
  const links = [...html.matchAll(/<a\b([^>]*)href="([a-z0-9-]+)\.html[^"]*"([^>]*)>\s*([^<]*)/g)]
    .filter((m) => !/class="[^"]*\bback\b|aria-label="返回/.test(m[1] + m[3]) && !/^[‹<←]\s*$/.test(m[4]))
    .map((m) => m[2])
    .filter((t) => t !== name && !TABBAR.has(t));
  const listeners = (html.match(/addEventListener\(\s*["'](click|change|input|submit)["']/g) || []).length;
  const onclicks = (html.match(/\bonclick=/g) || []).length;
  const dataActions = [...html.matchAll(/data-(action|send|preview|picker|filter|type)="([^"{}$+']*)"/g)]
    .map((m) => `${m[1]}=${m[2]}`);
  return { buttons, links: [...new Set(links)], listeners, onclicks, dataActions: [...new Set(dataActions)] };
}

/* ── 自测（PRD §6）───────────────────────────────────────────────────────── */

if (SELFTEST) {
  let pass = 0, fail = 0;
  const check = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } };

  // 1. 沙箱超时：死循环的 index.js 要在 2000ms 内被打断，并退回正则保底
  const dir = mkdtempSync(join(tmpdir(), 'wiring-'));
  writeFileSync(join(dir, 'index.js'), 'Page({\n  data: {},\n  onTap() {},\n});\nwhile (true) {}\n');
  const t0 = Date.now();
  const pg = loadPage(dir);
  rmSync(dir, { recursive: true, force: true });
  check('死循环 index.js 在 2000ms 左右被中断', Date.now() - t0 < 4000, `耗时 ${Date.now() - t0}ms`);
  check('中断后退回正则保底，仍抓到 onTap', pg.methods.has('onTap'), `抓到：${[...pg.methods.keys()].join(',')}`);

  // 2. 属性里带 > 与多重插值的标签流解析：不得提前截断，行号不得错位
  const nodes = parseWxml('<view>\n  <view class="btn {{count > 0 ? \'active\' : \'\'}}" data-url="a>b" bindtap="onGo">去</view>\n  <text>尾</text>\n</view>');
  const btn = nodes.find((n) => n.attrs.bindtap === 'onGo');
  check('属性内的 > 不截断标签', btn && btn.attrs['data-url'] === 'a>b', btn && JSON.stringify(btn.attrs));
  check('行号正确', btn && btn.line === 2, btn && `行 ${btn.line}`);
  check('后续节点仍被解析', nodes.some((n) => n.tag === 'text' && n.text === '尾'));

  // 3. 动态路径常量替换
  const consts = new Map([['TASK_PATH', '/tasks']]);
  check('`${TASK_PATH}/${taskId}/submissions` → /tasks/{*}/submissions', normalize(resolvePathExpr('`${TASK_PATH}/${taskId}/submissions`', consts) || '') === '/tasks/{*}/submissions', resolvePathExpr('`${TASK_PATH}/${taskId}/submissions`', consts));
  check("TASK_PATH + '/weekly' → /tasks/weekly", resolvePathExpr("TASK_PATH + '/weekly'", consts) === '/tasks/weekly', resolvePathExpr("TASK_PATH + '/weekly'", consts));
  check('未知前缀变量记成 {?}', (resolvePathExpr('`${path}/${id}/submission`', consts) || '').startsWith('{?}'), resolvePathExpr('`${path}/${id}/submission`', consts));

  // 4. 请求体键：值里的标识符不算键
  const keys = literalKeys('feedback_text: text, file_id: fileIds || [], ...rest');
  check('literalKeys 只取键', keys.join(',') === 'feedback_text,file_id', keys.join(','));

  // 5. <import> 进来的模板算这一页的 WXML —— 绑定写在模板里时，不得报成「没绑」
  const idir = mkdtempSync(join(tmpdir(), 'wiring-import-'));
  writeFileSync(join(idir, 'tpl.wxml'), '<template name="t">\n  <view bindtap="onPageTap">页</view>\n</template>\n');
  writeFileSync(join(idir, 'index.wxml'), '<import src="tpl.wxml" />\n<template is="t" />\n');
  const merged = readWxml(idir);
  rmSync(idir, { recursive: true, force: true });
  check('<import> 的模板并进本页 WXML', /bindtap="onPageTap"/.test(merged), merged.replace(/\n/g, '⏎'));

  // 6. L2 的「像按钮」判定（#8）。片段都从仓库抄来，注释写出处。
  //    断言连 level 一起钉 —— 只断言「非 null」的话，等级译反了照样过（CLAUDE.md §7.6）。
  const one = (wxml) => { const ns = parseWxml(wxml); return buttonish(ns[0]); };
  const b1 = one('<view class="btn btn--primary" hover-class="btn--hover">保存草稿</view>'); // parent-task-publish/index.wxml:80
  check('L2-1 hover-class 判高疑', b1 && b1.level === 'likely' && /hover-class/.test(b1.detail), JSON.stringify(b1));
  const b2 = one('<view class="btn btn--primary" hover-class="none">保存草稿</view>');
  check('L2-2 hover-class="none" 落到类名分支', b2 && b2.level === 'likely' && /类名/.test(b2.detail), JSON.stringify(b2));
  const b3 = one('<view class="tool-btn"><image src="x" /></view>');
  check('L2-3 无文案的图标按钮也报（钉住旧词表的漏报）', b3 && b3.level === 'likely', JSON.stringify(b3));
  check('L2-4 btn-row 是容器，不报', one('<view class="btn-row"></view>') === null); // comprehensive-assessment-report/index.wxml:50
  check('L2-5 state-actions／entry-grid／action-row 都是容器',
    one('<view class="state-actions"></view>') === null && one('<view class="entry-grid"></view>') === null && one('<view class="action-row"></view>') === null);
  check('L2-6 submit-note 是说明文字，不报', one('<view class="submit-note">草稿只有你看得到，家长看不到。</view>') === null); // parent-task-publish/index.wxml:86
  check('L2-7 sec__title 上的「报名入口」是标题，不报', one('<text class="sec__title">报名入口</text>') === null); // training-detail/index.wxml:60
  // 两头都钉：类名否决表挡住 .empty 上的空态文案，动词表本身也不收「加载」（§7.4 的两头钉）
  check('L2-8a .empty 上的「加载中…」不报（类名否决）', one('<view class="empty">加载中…</view>') === null);
  check('L2-8b 「加载中…」本身不是按钮文案（动词表不收「加载」）', BUTTONISH_TEXT.test('加载中…') === false);
  const b9a = one('<view class="btn">提交审核</view>'), b9b = one('<text class="kicker">提交审核</text>');
  check('L2-9 同一段文案：.btn 上报、.kicker 上不报', b9a !== null && b9b === null, `${JSON.stringify(b9a)} / ${JSON.stringify(b9b)}`); // upload-resource/index.wxml:8
  check('L2-10 「点此重试」越过标签否决表', one('<view class="hint">点此重试</view>') !== null); // training-list/index.wxml:23
  const inp = parseWxml('<input value="{{q}}" />')[0], inp2 = parseWxml('<input value="{{q}}" bindinput="onInput" />')[0];
  check('L2-11 裸 input 报、有 bindinput 的不报', buttonish(inp) !== null && hasUpdateChannel(inp2), `${JSON.stringify(buttonish(inp))} / ${hasUpdateChannel(inp2)}`);
  const dl = parseWxml('<view class="btn-dl" bindtap="onDownloadPlan">\n  <text class="btn-dl__title">下载Word详案</text>\n</view>'); // case-detail/index.wxml:47
  check('L2-12 BEM 子元素靠祖先带 tap 兜住，不重复报', ancestorHasTap(dl.find((n) => n.attrs.class === 'btn-dl__title')));
  const containers = ['btn-row', 'btn-group', 'btns', 'action-row', 'state-actions', 'sheet-actions', 'entry-grid', 'eval-entry-grid', 'card-list', 'album-grid', 'controls', 'submit-note', 'upload-note'];
  const leaked = containers.filter((w) => one(`<view class="${w}"></view>`) !== null);
  check('L2-13 两张类名表互斥：13 个容器词一个都不判成按钮', leaked.length === 0, `漏的：${leaked.join(',')}`);

  console.log(`\n${pass} 项通过，${fail} 项失败。`);
  process.exit(fail ? 1 : 0);
}

/* ── 业务注解：这是什么、在哪一页、按钮写什么、谁发起给谁看 ──────────────── */

const GLOSSARY = JSON.parse(read(join(HERE, 'lib', 'wiring-glossary.json')));

/** 页面路径：从底部导航五项起步做 BFS，边 = 页面 JS／WXML 里出现的 /pages/x/index。 */
const navPath = (() => {
  const titleOf = new Map(pages.map((p) => [p.name, p.title || p.name]));
  const TABBAR = [['home', '底部导航「首页」'], ['school-affairs', '底部导航「党建管理」'], ['comprehensive-coordination', '底部导航「综合协调」'], ['training-center', '底部导航「教研培训」'], ['home-school', '底部导航「家园社共育」']];
  const edges = new Map();
  for (const p of pages) {
    const src = read(join(p.dir, 'index.js')) + readWxml(p.dir);
    edges.set(p.name, [...new Set([...src.matchAll(/\/pages\/([a-z0-9-]+)\/index/g)].map((m) => m[1]).filter((t) => t !== p.name))]);
  }
  const path = new Map(TABBAR);
  const queue = TABBAR.map(([n]) => n);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of edges.get(cur) || []) {
      if (path.has(next)) continue;
      path.set(next, `${path.get(cur)} → ${titleOf.get(next)}`);
      queue.push(next);
    }
  }
  // CLAUDE.md §3 的表是人写的、更准，能读到就覆盖
  try {
    const md = read(join(REPO, 'CLAUDE.md'));
    for (const m of md.matchAll(/^\| `([a-z0-9-]+)`(?: \/ `(-[a-z]+)`)? \| ([^|]+) \| ([^|]+) \|$/gm)) {
      const clean = m[4].replace(/\*\*/g, '').trim();
      path.set(m[1], clean);
      if (m[2]) path.set(m[1].replace(/-list$/, '') + m[2], clean);
    }
  } catch { /* 没有也行 */ }
  return (name) => path.get(name) || '（从五个底部导航都走不到——只能由别处深链进来，或尚未挂入口）';
})();

function pageContext(name) {
  const p = pages.find((x) => x.name === name);
  const g = GLOSSARY.pages[name] || {};
  const reg = screensTsv.get(name);
  return { title: p ? p.title : '', path: navPath(name), module: reg ? reg.module : '', role: g.role || '', flow: g.flow || '' };
}
function handlerNote(pageName, handler) {
  return GLOSSARY.handlers[`${pageName}.${handler}`] || GLOSSARY.handlers[`${pageName}.*`] || '';
}

/* ── 审核结论（PRD 决策 5：sticky allowlist）──────────────────────────────── */

const ALLOWLIST_PATH = join(REPO, 'docs', 'audit', 'wiring.allowlist.json');
const allowlist = new Map();
if (existsSync(ALLOWLIST_PATH)) {
  for (const r of JSON.parse(read(ALLOWLIST_PATH)).rules || []) allowlist.set(r.key, r);
}
const verdictOf = (key) => allowlist.get(key) || null;
const verdictText = (v) => (v ? `${v.status}${v.reason ? `：${v.reason}` : ''}${v.author ? `（${v.author} ${v.updated_at || ''}）` : ''}` : '');
const isFalsePositive = (v) => v && /^(误报|誤報|FALSE_POSITIVE)$/i.test(v.status);

/* ── 逐页汇总 ─────────────────────────────────────────────────────────────── */

const services = readdirSync(join(MP, 'services')).filter((f) => f.endsWith('.js'))
  .map((f) => scanService(join(MP, 'services', f)));
const allWxml = pages.map((p) => readWxml(p.dir)).join('\n');

/* ── --emit：写后端 db/spec 的两份表 ──────────────────────────────────────
 * 决定与取舍见 hualong-teacher/decision.md 的 2026-09-11 一条。
 * 走到这里才调：`pages`（55 页）、`services`（已扫的 service）、`ops`（契约）
 * 都已就位，而审计报告一个字都还没写。
 */
if (EMIT) {
  emitScreenOperations({
    pages, loadPage, services, opIndex, normalize, ops, actionRegistry, screensTsv,
    readWxml, parseWxml, eventsOf, prototypeInteractions, BACKEND, scanService,
    utilsDir: join(MP, 'utils'),
  });
  process.exit(0);
}

const report = { generatedAt: new Date().toISOString(), contract: specPath(), pages: [], services: [], contractUnused: [], summary: {} };
const LEVEL = { sure: '确定', likely: '高疑', review: '待审' };

for (const p of pages) {
  const wxmlText = readWxml(p.dir);
  const nodes = parseWxml(wxmlText);
  const page = loadPage(p.dir);
  const wired = page.serviceAliases.length > 0;
  const reg = screensTsv.get(p.name);
  const findings = [];
  const ctx = pageContext(p.name);
  const add = (level, layer, line, what, detail) => {
    const key = `${p.name}:${layer}:${what}`;
    const v = verdictOf(key);
    const handler = (what.match(/(?:bind|catch)[a-z:-]*="([A-Za-z_$][\w$]*)"/) || what.match(/^方法 (\w+)\(\)/) || [])[1];
    const button = (what.match(/「([^」]+)」/) || [])[1] || '';
    findings.push({ key, level, layer, line, what, detail, verdict: v, falsePositive: isFalsePositive(v),
      context: { page: p.name, ...ctx, button, note: handler ? handlerNote(p.name, handler) : '' } });
  };

  // L1
  const handlersUsed = new Map();
  for (const n of nodes) {
    for (const ev of eventsOf(n.attrs)) {
      if (!ev.handler || ev.handler.includes('{{')) {
        add('review', 'L1', n.line, `<${n.tag} ${ev.attr}="${ev.handler}">`, 'handler 名由表达式算出，静态查不了');
        continue;
      }
      handlersUsed.set(ev.handler, (handlersUsed.get(ev.handler) || 0) + 1);
      const c = classifyHandler(page, ev.handler);
      const label = `<${n.tag}${n.attrs.class ? ` class="${n.attrs.class}"` : ''}> ${ev.attr}="${ev.handler}"${n.text ? `「${n.text}」` : ''}`;
      if (c.kind === 'missing') add('sure', 'L1', n.line, label, 'Page 里没有这个方法，点了什么都不会发生');
      else if (c.kind === 'stub' && c.empty && ev.attr.startsWith('catch')) { /* 空的 catchtap 是拦截冒泡，正常 */ }
      else if (c.kind === 'stub') add('likely', 'L1', n.line, label, c.placeholder ? '占位 handler（提示「尚未开放／开发中」一类）' : 'handler 无 setData、无导航、无 service 调用，只弹提示或为空');
      else if (c.kind === 'local' && c.placeholder) add('likely', 'L1', n.line, label, 'handler 改了本地状态，但带「开发中／本环境不接」字样');
      else if (c.kind === 'local' && wired && TAP_EVENTS.has(ev.event) && /提交|发布|保存|删除|报名|上传|加入|撤回|发送|确认/.test(n.text)) {
        add('review', 'L1', n.line, label, '写入类文案，handler 却只改本地 data，没到 service');
      }
      // GAP-W（PRD 决策 4）：handler 到了 service 且读了 this.data.x，但页面上 value="{{x}}" 的
      // 控件没有任何把值写回来的通道 —— 教师改了字，发出去的还是旧值。
      if (c.kind === 'service' && TAP_EVENTS.has(ev.event) && c.reads) {
        for (const field of c.reads) {
          const bound = nodes.filter((x) => (x.attrs.value || '').replace(/\s/g, '') === `{{${field}}}`);
          for (const x of bound) {
            if (!hasUpdateChannel(x)) add('review', 'L1', x.line, `<${x.tag}> value="{{${field}}}"`, `数据流断裂（GAP-W）：${ev.handler}() 读 this.data.${field} 发给 service，这个控件却没有 bindinput／bindchange／model:value 把改动写回`);
          }
        }
      }
    }
  }

  // L2
  for (const n of nodes) {
    const evs = eventsOf(n.attrs);
    if (evs.length || ancestorHasTap(n)) continue;
    if (n.tag === 'navigator' && n.attrs.url) continue;
    const cls = n.attrs.class || '';
    const label = `<${n.tag}${cls ? ` class="${cls}"` : ''}>${n.text ? `「${n.text}」` : ''}`;
    const b = buttonish(n);
    if (b) add(b.level, 'L2', n.line, label, b.detail);
  }

  // L5
  const proto = prototypeInteractions(p.name);
  if (proto) {
    for (const b of proto.buttons) {
      const t = b.text.replace(/^[＋+]\s*/, '');
      if (t.length < 2 || t.length > 12) continue;
      if (!wxmlText.includes(t) && !wxmlText.includes(b.text) && !page.src.includes(t)) {
        add('review', 'L5', 0, `原型按钮「${b.text}」`, `screens/${p.name}.html 有这个按钮，index.wxml 里找不到这段文案`);
      }
    }
    const navTargets = new Set([...page.src.matchAll(/\/pages\/([a-z0-9-]+)\/index/g)].map((m) => m[1]));
    for (const l of proto.links) {
      if (!navTargets.has(l) && !allWxml.includes(`/pages/${l}/`) && !/^(index|component-showcase)$/.test(l)) {
        if (pages.some((x) => x.name === l)) add('review', 'L5', 0, `原型跳转 → ${l}.html`, `原型从本页能到 ${l}，本页 index.js 里没有跳向 /pages/${l}/index 的代码`);
      }
    }
  }

  // L6
  const pageServiceCalls = services
    .filter((s) => page.serviceAliases.some((a) => s.file.endsWith(a.path.replace('../../services/', '').replace(/(\.js)?$/, '.js'))))
    .flatMap((s) => s.calls.filter((c) => c.verb !== 'GET' && new RegExp(`\\b${c.fn}\\s*\\(`).test(page.src) && page.serviceAliases.some((a) => page.src.includes(`${a.alias}.${c.fn}`))));
  if (reg && reg.writes === 'yes') {
    if (!wired) add('likely', 'L6', 0, 'screens.tsv writes=yes', '登记为有写入的页面，却没有 require 任何 service（整页仍是字面量）');
    else if (!pageServiceCalls.length && !/training\[action\]/.test(page.src)) add('likely', 'L6', 0, 'screens.tsv writes=yes', '接了 service，但本页没有调到任何 POST／PUT／PATCH／DELETE');
  }

  // 未被 WXML 引用的 handler（on* 且不是生命周期）
  const LIFECYCLE = new Set(['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom', 'onShareAppMessage', 'onPageScroll', 'onResize', 'onTabItemTap', 'onSaveExitState']);
  for (const name of page.methods.keys()) {
    if (!/^on[A-Z]/.test(name) || LIFECYCLE.has(name) || handlersUsed.has(name)) continue;
    if (new RegExp(`this\\.${name}\\b`).test(page.src)) continue;
    add('review', 'L1', 0, `方法 ${name}()`, 'Page 里定义了 on* 方法，WXML 没有任何元素绑到它（可能是删元素时留下的）');
  }

  if (page.loadError && !page.captured) add('review', 'L1', 0, 'index.js', `vm 加载失败，方法名改用正则抓取：${page.loadError}`);

  report.pages.push({
    name: p.name, title: p.title, wired, writes: reg ? reg.writes : '(未登记)', context: ctx,
    events: [...nodes].reduce((n, x) => n + eventsOf(x.attrs).length, 0),
    prototype: proto ? { buttons: proto.buttons.length, listeners: proto.listeners + proto.onclicks, links: proto.links.length } : null,
    findings,
  });
}

/* ── L3／L4：service ↔ 契约 ───────────────────────────────────────────────── */

const usedOps = new Set();
for (const s of services) {
  const rel = s.file.replace(REPO, '').replace(/\\/g, '/');
  const findings = [];
  const base = rel.replace(/^.*\/([^/]+)\.js$/, '$1');
  const pageSrcs = pages.map((p) => ({ name: p.name, title: p.title, src: read(join(p.dir, 'index.js')) }));
  const tag = (f) => {
    f.key = `service:${rel}:${f.what}`;
    f.layer = 'L3';
    f.verdict = verdictOf(f.key);
    f.falsePositive = isFalsePositive(f.verdict);
    // 这条调用属于哪个函数、函数头注怎么说、哪些页面的哪个 handler 调它
    const fn = (f.what.match(/^(\w+)\(\)/) || [])[1];
    if (fn) {
      // 紧贴在函数上方的那一段 /** */（中间只能有空白），不是文件头注
      const at = new RegExp(`(?:async\\s+)?function\\s+${fn}\\s*\\(`).exec(s.src);
      const before = at ? s.src.slice(0, at.index) : '';
      const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/.exec(before);
      const docLine = doc ? doc[1].split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean)[0] || '' : '';
      const callers = [];
      for (const pg of pageSrcs) {
        for (const m of pg.src.matchAll(new RegExp(`\\.${fn}\\s*\\(`, 'g'))) {
          const before = pg.src.slice(0, m.index);
          const method = [...before.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)].pop();
          callers.push(`${pg.name}（${pg.title}）${method ? ` 的 ${method[1]}()` : ''}`);
        }
      }
      const g = GLOSSARY.services[`${base}.${fn}`] || {};
      f.context = { fn, doc: docLine, callers: [...new Set(callers)], what: g.what || '', where: g.where || '', who: g.who || '' };
    }
    return f;
  };
  for (const c of s.calls) {
    const where = `${c.fn}() 第 ${c.line} 行`;
    if (!c.path) { findings.push({ level: 'review', line: c.line, what: `${where} ${c.verb} ${c.pathExpr}`, detail: '路径表达式静态算不出' }); continue; }
    if (c.path.includes('{?}')) {
      // 前缀是变量（按类型挑 path）：拿后缀去匹配，命中的都算用到
      const shape = c.path.replace(/\{(?!\?\})[^}]*\}/g, '{*}');
      const re = new RegExp(`^${shape.split(/(\{\?\}|\{\*\})/).map((seg) => (seg === '{?}' ? '.+' : seg === '{*}' ? '\\{\\*\\}' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`);
      const hits = ops.filter((o) => o.method === c.verb && re.test(normalize(o.path)));
      for (const o of hits) usedOps.add(`${o.method} ${normalize(o.path)}`);
      findings.push({ level: hits.length ? 'review' : 'sure', line: c.line, what: `${where} ${c.verb} ${c.pathExpr}`, detail: hits.length ? `路径前缀由变量决定，按后缀匹配到 ${hits.length} 条契约操作：${hits.map((o) => o.path).join('、')}` : '路径前缀由变量决定，后缀在契约里找不到任何操作' });
      continue;
    }
    const key = `${c.verb} ${normalize(c.path)}`;
    const op = opIndex.get(key);
    if (!op) {
      const pathKnown = pathSet.has(normalize(c.path));
      findings.push({ level: 'sure', line: c.line, what: `${where} ${c.verb} ${c.path}`, detail: pathKnown ? `契约有这条路径，但没有 ${c.verb}（允许：${ops.filter((o) => normalize(o.path) === normalize(c.path)).map((o) => o.method).join('/')}）` : '契约里没有这条路径，服务端会回 404／501' });
      continue;
    }
    usedOps.add(key);
    if (!op.roles.includes('teacher') && !op.isPublic) findings.push({ level: 'sure', line: c.line, what: `${where} ${key}`, detail: `x-hualong-roles 是 ${op.roles.join('|')}，不含 teacher，教师调会 403` });
    if (op.blockedOn.length) findings.push({ level: 'review', line: c.line, what: `${where} ${key}`, detail: `契约标了 x-hualong-blocked-on: ${op.blockedOn.join(', ')}` });
    if (c.action && op.actions.length && !op.actions.includes(c.action)) findings.push({ level: 'sure', line: c.line, what: `${where} action=${c.action}`, detail: `契约这条操作的 x-hualong-action 是 ${op.actions.join('|')}` });
    if (!c.action && op.actions.length && c.verb !== 'GET') findings.push({ level: 'review', line: c.line, what: `${where} ${key}`, detail: `契约有 x-hualong-action ${op.actions.join('|')}，调用没带 action（幂等键可能不会自动补）` });
    const schema = requestSchema(op);
    if (schema && c.bodyKeys) {
      const props = new Set(Object.keys(schema.properties || {}));
      const unknown = c.bodyKeys.filter((k) => !props.has(k));
      const missing = (schema.required || []).filter((k) => !c.bodyKeys.includes(k));
      if (unknown.length) findings.push({ level: schema.additionalProperties === false ? 'sure' : 'likely', line: c.line, what: `${where} 请求体键 ${unknown.join(', ')}`, detail: `schema 没有这些键${schema.additionalProperties === false ? '，additionalProperties:false，会 422' : ''}` });
      if (missing.length) findings.push({ level: 'review', line: c.line, what: `${where} 请求体缺 ${missing.join(', ')}`, detail: 'schema 标 required，代码里没看到这些键（可能由条件分支补）' });
    } else if (schema && c.verb !== 'GET' && c.bodyKeys === null && /\bbody\b/.test(c.pathExpr + s.src.slice(0, 0))) {
      findings.push({ level: 'review', line: c.line, what: `${where} ${key}`, detail: '请求体不是字面量，键静态查不了' });
    }
  }
  // 导出了但没有任何页面用到的函数
  const pageSrc = pages.map((p) => read(join(p.dir, 'index.js'))).join('\n');
  const unusedExports = s.exported.filter((fn) => !new RegExp(`\\.${fn}\\b`).test(pageSrc) && !/^[A-Z_]+$/.test(fn));
  report.services.push({ file: rel, calls: s.calls.length, findings: findings.map(tag), unusedExports });
}

for (const o of ops) {
  if (!o.roles.includes('teacher')) continue;
  const key = `${o.method} ${normalize(o.path)}`;
  if (usedOps.has(key)) continue;
  if (/^\/(auth|media)\//.test(o.path)) continue; // utils/request、utils/auth 那一层用的，不经 service
  const akey = `contract:${o.method} ${o.path}`;
  const v = verdictOf(akey);
  const raw = spec.paths[o.path][o.method.toLowerCase()];
  const regRow = o.actions.map((a) => actionRegistry.get(a)).find(Boolean);
  const g = GLOSSARY.ops[`${o.method} ${o.path}`] || {};
  const hostPage = g.page ? g.page.replace(/（.*$/, '') : '';
  report.contractUnused.push({
    key: akey, method: o.method, path: o.path, tags: o.tags.join(','), action: o.actions.join('|'), blockedOn: o.blockedOn.join(','), summary: o.summary || '', verdict: v, falsePositive: isFalsePositive(v),
    context: {
      description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      registry: regRow ? { table: regRow.target_table, from: regRow.from_state, to: regRow.to_state, precondition: regRow.precondition, authority: regRow.authority } : null,
      page: g.page || '', pageTitle: hostPage ? (pages.find((p) => p.name === hostPage) || {}).title || '' : '', path: hostPage ? navPath(hostPage) : '',
      button: g.button || '', who: g.who || '',
    },
  });
}

/* ── 输出 ─────────────────────────────────────────────────────────────────── */

const live = (f) => !f.falsePositive;
const count = (lvl) => report.pages.reduce((n, p) => n + p.findings.filter((f) => f.level === lvl && live(f)).length, 0)
  + report.services.reduce((n, s) => n + s.findings.filter((f) => f.level === lvl && live(f)).length, 0);
const falsePositives = [
  ...report.pages.flatMap((p) => p.findings.filter((f) => f.falsePositive).map((f) => ({ ...f, where: p.name }))),
  ...report.services.flatMap((s) => s.findings.filter((f) => f.falsePositive).map((f) => ({ ...f, where: s.file }))),
];
report.summary = {
  pages: pages.length, wired: report.pages.filter((p) => p.wired).length,
  sure: count('sure'), likely: count('likely'), review: count('review'),
  falsePositives: falsePositives.length,
  decided: [...report.pages.flatMap((p) => p.findings), ...report.services.flatMap((s) => s.findings), ...report.contractUnused].filter((f) => f.verdict).length,
  contractTeacherOps: ops.filter((o) => o.roles.includes('teacher')).length,
  contractUnused: report.contractUnused.filter(live).length,
};

const md = [];
const date = new Date().toISOString().slice(0, 10);
md.push(`# 接线扫描 ${date}`, '', `契约：\`${report.contract}\``, '', '## 总览', '', '| 计数项 | 值 |', '| --- | --- |');
md.push(`| 页面 | ${report.summary.pages}（已接 service ${report.summary.wired}，未接 ${report.summary.pages - report.summary.wired}） |`);
md.push(`| 确定 | ${report.summary.sure} |`, `| 高疑 | ${report.summary.likely} |`, `| 待审 | ${report.summary.review} |`);
md.push(`| 契约教师可调操作 | ${report.summary.contractTeacherOps}，其中无 service 调用 ${report.summary.contractUnused} |`);
md.push(`| 已有审核结论（wiring.allowlist.json） | ${report.summary.decided}，其中判误报 ${report.summary.falsePositives}（折叠在文末） |`, '');
md.push('等级：**确定** = 机器能证明（handler 不存在、路径不在契约、请求体键不在 schema）；**高疑** = 有交互外观无事件、占位 handler、writes=yes 无写入；**待审** = 原型有小程序无、只改本地状态、契约有客户端未用。', '');
md.push('查不出的：元素与事件都没有、原型里也没有的功能；handler 调了 service 但逻辑写错的；渲染。', '');
md.push('「结论」列留给审核：写「接」「不建（DO-NOT-BUILD n）」「阻于 Gnn」「误报」之一。', '');

md.push('## 一、service → 契约（L3）', '');
for (const s of report.services) {
  md.push(`### ${s.file}（${s.calls} 次 api 调用）`, '');
  const liveFindings = s.findings.filter(live);
  if (!liveFindings.length) md.push('无发现。', '');
  else {
    md.push('| 等级 | 位置 | 现象 | 结论 |', '| --- | --- | --- | --- |');
    for (const f of liveFindings) md.push(`| ${LEVEL[f.level]} | ${f.what} | ${f.detail} | ${verdictText(f.verdict)} |`);
    md.push('');
  }
  if (s.unusedExports.length) md.push(`导出但没有页面用到：\`${s.unusedExports.join('`, `')}\``, '');
}

md.push('## 二、契约有、客户端没调的教师端操作（L4）', '', '这是「不知道它存在」的那一类。逐条判断：该接、已决定不建（查 DO-NOT-BUILD.md）、还是被 GAPS 阻着。', '');
md.push('| 方法 | 路径 | 模块 | 动作键 | 阻断于 | 摘要 | 结论 |', '| --- | --- | --- | --- | --- | --- | --- |');
for (const u of report.contractUnused.filter(live)) md.push(`| ${u.method} | \`${u.path}\` | ${u.tags} | ${u.action} | ${u.blockedOn} | ${u.summary.replace(/\|/g, '／').split('\n')[0]} | ${verdictText(u.verdict)} |`);
md.push('');

const section = (title, list) => {
  md.push(`## ${title}`, '');
  for (const p of list) {
    const fs_ = p.findings.filter(live);
    const c = (l) => fs_.filter((f) => f.level === l).length;
    md.push(`### ${p.name}（${p.title || '无标题'}）`, '');
    md.push(`已接 service：${p.wired ? '是' : '否'} · screens.tsv writes：${p.writes} · WXML 事件 ${p.events} 个` + (p.prototype ? ` · 原型：按钮 ${p.prototype.buttons}、监听 ${p.prototype.listeners}、跳转 ${p.prototype.links}` : ' · 无原型') + ` · 确定 ${c('sure')} / 高疑 ${c('likely')} / 待审 ${c('review')}`, '');
    if (!fs_.length) { md.push('无发现。', ''); continue; }
    md.push('| 等级 | 层 | 行 | 元素／对象 | 现象 | 结论 |', '| --- | --- | --- | --- | --- | --- |');
    const order = { sure: 0, likely: 1, review: 2 };
    for (const f of [...fs_].sort((a, b) => order[a.level] - order[b.level] || a.line - b.line)) {
      md.push(`| ${LEVEL[f.level]} | ${f.layer} | ${f.line || ''} | ${f.what.replace(/\|/g, '／')} | ${f.detail.replace(/\|/g, '／')} | ${verdictText(f.verdict)} |`);
    }
    md.push('');
  }
};
section('三、已接 service 的页面（这里的缺口最意外）', report.pages.filter((p) => p.wired));
section('四、未接 service 的页面（缺口是预期的，这里是待办清单）', report.pages.filter((p) => !p.wired));

if (falsePositives.length || report.contractUnused.some((u) => u.falsePositive)) {
  md.push('## 五、已判误报（折叠）', '', '<details><summary>展开</summary>', '', '| 位置 | 元素／对象 | 结论 |', '| --- | --- | --- |');
  for (const f of falsePositives) md.push(`| ${f.where} | ${f.what.replace(/\|/g, '／')} | ${verdictText(f.verdict)} |`);
  for (const u of report.contractUnused.filter((x) => x.falsePositive)) md.push(`| 契约 | ${u.method} ${u.path} | ${verdictText(u.verdict)} |`);
  md.push('', '</details>', '');
}

const text = md.join('\n') + '\n';
if (STDOUT) {
  process.stdout.write(text);
} else {
  const outDir = join(REPO, 'docs', 'audit');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `wiring-${date}.md`), text, 'utf8');
  writeFileSync(join(outDir, `wiring-${date}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
  // 检视器：模板在 tools/lib/wiring-viewer.html，数据内嵌，双击就能开，不用起服务
  const tpl = read(join(HERE, 'lib', 'wiring-viewer.html'));
  const payload = JSON.stringify(report).replace(/<\/script/gi, '<\\/script');
  writeFileSync(join(outDir, `wiring-${date}.html`), tpl.replace('/*__DATA__*/null', payload), 'utf8');
  console.log(`页面 ${report.summary.pages}（已接 ${report.summary.wired}）· 确定 ${report.summary.sure} · 高疑 ${report.summary.likely} · 待审 ${report.summary.review} · 契约未用 ${report.summary.contractUnused}/${report.summary.contractTeacherOps} · 已有结论 ${report.summary.decided}（误报 ${report.summary.falsePositives}）`);
  console.log(`写出：docs/audit/wiring-${date}.md / .json / .html`);
}
