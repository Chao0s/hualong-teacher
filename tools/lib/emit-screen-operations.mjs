/**
 * `scan-wiring.mjs --emit` 的实现：写出 hualong-backend/db/spec 下两份表。
 *
 *   screen-operations.tsv   一个屏幕的一个操作一行（本文件生成 gen 行）
 *   operation-eli10.tsv     一个操作一段人话（本文件只填机器可推的部分）
 *
 * 两条规则，写在代码里而不是写在文档里：
 *
 *   1. **只重写 `source=gen` 的行。** 人工行（`human`／`planned`）原样留着，
 *      不然评审结论会被下一次跑抹掉。
 *   2. **上一轮是 gen、这一轮算不出来的行，不删，改标 `stale`。**
 *      页面不再调某个操作是个信号，不是垃圾。静默删除会把信号吞掉。
 *      闸门看到 `stale` 报红，由人决定是补回还是删。
 *
 * 「影响」那一行的算法（不是猜的）：
 *   action-registry.tsv 的 target_table / also_writes 取出 db_ 表名
 *   ∩ screens.tsv 的 primary_tables —— 两者用同一套表名。
 *
 * 「触发语」两列的算法：以 wxml 为准。wxml 那句在原型按钮文案里找不到一模一样的，
 * 看有没有共享 3 个连续字（`文案不同`），一个字都不沾就记 `只wxml`。
 * 原型里没有可机读的按钮表（`screens/*.html` 多数没有 <button>），所以
 * `只wxml` 占多数是**真的**，不是匹配没做好。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HEAD_SCREEN_OPS = [
  'screen', 'mp_file', 'screen_title', 'state', 'operation_id', 'method', 'path',
  'source', 'trigger_wxml', 'trigger_prototype', 'trigger_flag', 'gap', 'notes',
];
const HEAD_ELI10 = ['key', '幹嘛', '怎麼走', '碰到誰', 'derived_from'];

/** handler 本体 + 沿 `this.xxx(` 并进来的本页其它方法体（最多 8 个，与 scan-wiring 一致）。 */
function unionBody(page, name) {
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
  return union;
}

/**
 * 取 `function NAME(...) { ... }` 的整段函数体（花括号配平）。取不到返回空串。
 *
 * **必须先跳过参数表，再找函数体的 `{`。** 第一版直接 `indexOf('{', 定义处)`，
 * 于是参数里的解构花括号被当成了函数体开头 —— `parentEvalPeriods({ limit } = {})`
 * 取到的是 `{ limit }`（9 字节），而真正的函数体 977 字节。
 *
 * 后果不是「少几行」，是**间接调用这一条链断在那里**：直接调 `listParentEvaluations()`
 * 的页面照样登记得到（名字对得上），而绕着 `parentEvalPeriods()` 调的
 * `parent-evaluation-publish`（「发布家长测评」）就漏了 —— 实测它确实漏了。
 * 这个代码库里 `({ x } = {})` 这种签名很常见，所以影响面不小。
 */
function bodyOf(src, name) {
  const re = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return '';
  // 先配平跳过参数表（跳过字符串与模板字面量里的括号）
  let i = src.indexOf('(', m.index);
  if (i < 0) return '';
  let pdepth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') { pdepth--; if (pdepth === 0) { i++; break; } }
    else if (ch === '`') { const j = src.indexOf('`', i + 1); i = j < 0 ? src.length : j; }
    else if (ch === "'" || ch === '"') { const j = src.indexOf(ch, i + 1); i = j < 0 ? src.length : j; }
  }
  const open = src.indexOf('{', i);
  if (open < 0) return '';
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    const ch = src[k];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(open, k + 1); }
    else if (ch === '`') { const j = src.indexOf('`', k + 1); k = j < 0 ? src.length : j; }
    else if (ch === "'" || ch === '"') { const j = src.indexOf(ch, k + 1); k = j < 0 ? src.length : j; }
    else if (ch === '/' && src[k + 1] === '/') { const j = src.indexOf('\n', k); k = j < 0 ? src.length : j; }
  }
  return '';
}

/**
 * service 内部可达的函数集合，从 startFn 出发。
 *
 * 必须走这一步：`party.home()` 自己一次 `api.*` 都不调，它由 `listStudies()`／`listBrands()`
 * 拼出来，真正碰契约的是后者。只追一跳会把 school-affairs 这类页面判成「一屏不调任何操作」。
 */
function reachableFns(svc, startFn) {
  const known = new Set([...svc.exported, ...svc.calls.map((c) => c.fn)]);
  const bodies = new Map();
  const body = (n) => { if (!bodies.has(n)) bodies.set(n, bodyOf(svc.src, n)); return bodies.get(n); };
  const out = new Set([startFn]);
  const queue = [startFn];
  while (queue.length && out.size <= 60) {
    const cur = queue.shift();
    for (const m of body(cur).matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (known.has(m[1]) && !out.has(m[1])) { out.add(m[1]); queue.push(m[1]); }
    }
  }
  return out;
}

/**
 * 屏幕状态（`state` 列）。**只在信号明确时写，否则留空** —— 空本身是信息。
 *
 * 第一版一律写一个带 `?` 的猜测，结果是 128 个 gen 行全带问号、其中 68 个都是同一个
 * `list?`（53%）。那一列因此没做它设计要做的事：一个覆盖一半的假分类，比空更坏，
 * 因为它看起来像信息。现在：
 *
 *   恰好命中一类 → 写那一类（不带问号，值在即信号明确）
 *   命中 0 类或 ≥2 类 → 留空
 *
 * **扫不到的**：弹层与对话框。静态扫描看不见运行时开的 `wx.showModal`／自定义层，
 * 所以「删除要不要二次确认」它答不了。这也正是第一版一直在猜的原因。
 */
function stateOf({ handler, trigger, op }) {
  const text = `${handler} ${trigger}`;
  const hits = new Set();
  if (/删除|删页|移除|撤回|锁定|定稿|下架|离园|取消/.test(text)) hits.add('dialog');
  if (/发布|提交|保存|新建|新增|上传|提醒|征集|归入|重命名|报名|修改|编辑|更正/.test(text)) hits.add('form');
  if (/详情|预览|查看/.test(text)) hits.add('detail');
  if (/列表|搜索|筛选|全部|历史/.test(text)) hits.add('list');
  if (hits.size === 1) return [...hits][0];
  if (hits.size > 1) return '';
  // 文案没给出信号时，退到**契约自己**的形状 —— 那不是猜屏幕，是说端点读一条还是读一批。
  if (op && op.method === 'GET') {
    if (op.path.includes('{')) return 'detail';
    return 'list';
  }
  return '';
}

const tableTokens = (s) => [...String(s || '').matchAll(/db_[a-z0-9_]+/g)].map((m) => m[0]);

const tsv = (head, rows) => `${[head, ...rows.map((r) => head.map((h) => String(r[h] ?? '').replace(/[\t\r\n]/g, ' ')))].map((c) => c.join('\t')).join('\n')}\n`;

function readTsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
  const head = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
}

/** 比文案用：去掉空白、全角加号、常见标点与包裹符号，让「＋ 新建栏目」与「新建栏目」算同一句。 */
const normText = (s) => String(s || '')
  .replace(/[\s\u3000]+/g, '')
  .replace(/[＋+]/g, '')
  .replace(/[「」『』“”"'’‘]/g, '')
  .replace(/[，。、；：！？,.;:!?]/g, '');

/**
 * 原型文案里找触发语的对应句。返回 `{ text, flag }`。
 *
 * `flag` 的五个值各说一件**不同**的事 —— 加宽枚举不是为了让某个分支能触发，
 * 是因为原来把三件事挤成了一个 `只wxml`（实测 40 行）：
 *
 *   （空）        逐字相同
 *   文案不同      归一化后相同（差在加号／空格／标点），原型那句记进 text
 *   只wxml        原型**有**按钮，但没有一句相近 —— 客户端这一句原型里没有
 *   原型无按钮    原型页一个 `<button>` 都没有，无从比较（实测 18 行）
 *   原型无文件    连原型文件都不在
 *
 * 「原型无按钮」与「只wxml」不是一回事：前者是**没有可比的东西**，后者是**有个不一样的东西**。
 */
function matchPrototype(protoTexts, trigger, protoExists) {
  if (!trigger) return { text: '', flag: '' };
  if (protoTexts.includes(trigger)) return { text: trigger, flag: '' };
  const nTrigger = normText(trigger);
  for (const t of protoTexts) {
    if (normText(t) === nTrigger) return { text: t, flag: '文案不同' };
  }
  // 一句里包含另一句（归一化后），也算「文案不同」并把原型那句留下来
  for (const t of protoTexts) {
    const n = normText(t);
    if (n.length >= 3 && nTrigger.length >= 3 && (n.includes(nTrigger) || nTrigger.includes(n))) {
      return { text: t, flag: '文案不同' };
    }
  }
  if (!protoExists) return { text: '', flag: '原型无文件' };
  if (!protoTexts.length) return { text: '', flag: '原型无按钮' };
  return { text: '', flag: '只wxml' };
}

export function emitScreenOperations(ctx) {
  const {
    pages, loadPage, services, opIndex, normalize, ops, actionRegistry, screensTsv,
    readWxml, parseWxml, eventsOf, prototypeInteractions, BACKEND, scanService, utilsDir,
  } = ctx;

  const SPEC = join(BACKEND, 'db', 'spec');
  const svcFileOf = (a) => a.path.replace('../../services/', '').replace(/(\.js)?$/, '.js');

  // 不经过 service 层的调用点：utils/*.js 里直接打 api.*（现为 utils/auth.js 的
  // `GET /auth/session`）。这些不能算「无人认领」，否则交付物里会多出一条假发现。
  // 客户端调了、契约里没有的调用。**不是垃圾** —— 它是「页面要用而契约没有」那一桶的事实来源。
  // 声明要排在 utils 那一段之前：utils 也会往这里投，`const` 之后用会 TDZ。
  const offContract = [];
  const titles = new Map(pages.map((p) => [p.name, p.title]));
  const utilsCallers = new Map();
  if (utilsDir && existsSync(utilsDir)) {
    for (const f of readdirSync(utilsDir).filter((x) => x.endsWith('.js'))) {
      const u = scanService(join(utilsDir, f));
      for (const c of u.calls) {
        const op = opIndex.get(`${c.verb} ${normalize(c.path)}`);
        if (!op || !op.operationId) {
          // utils 这一侧也要收。`utils/auth.js` 调的 `POST /dev/session` 是测试后端专用、
          // 契约里没有 —— 第一版在这里静默丢，于是第四桶恒为 0。它是那个桶的唯一真实样本。
          offContract.push({ screen: '(utils)', verb: c.verb, path: c.path, line: c.line, fn: c.fn, file: `utils/${f}` });
          continue;
        }
        if (!utilsCallers.has(op.operationId)) utilsCallers.set(op.operationId, new Set());
        utilsCallers.get(op.operationId).add(`utils/${f}`);
      }
    }
  }

  // 契约操作 → 它会动的表（target_table + also_writes 里的 db_ 名）
  const tablesOfOp = new Map();
  for (const o of ops) {
    const t = new Set();
    for (const a of o.actions) {
      const r = actionRegistry.get(a);
      if (!r) continue;
      tableTokens(r.target_table).forEach((x) => t.add(x));
      tableTokens(r.also_writes).forEach((x) => t.add(x));
    }
    tablesOfOp.set(o.operationId, t);
  }
  // 表 → 哪些屏幕把它列为主表
  const screensOfTable = new Map();
  for (const [name, reg] of screensTsv) {
    for (const t of tableTokens(reg.primary_tables)) {
      if (!screensOfTable.has(t)) screensOfTable.set(t, new Set());
      screensOfTable.get(t).add(name);
    }
  }

  const genRows = [];
  const callsOfOp = new Map(); // operationId → Map(screen → trigger)

  for (const p of pages) {
    const page = loadPage(p.dir);
    const nodes = parseWxml(readWxml(p.dir));
    const pageSvc = services.filter((s) => page.serviceAliases.some((a) => s.file.endsWith(svcFileOf(a))));
    const byAlias = new Map(page.serviceAliases.map((a) => [a.alias, pageSvc.find((s) => s.file.endsWith(svcFileOf(a)))]));
    const proto = prototypeInteractions(p.name);
    const protoTexts = proto ? proto.buttons.map((b) => b.text.trim()) : [];

    // opKey → { op, triggers: Set, handlers: Set, fn, text }
    const hits = new Map();
    const reachCache = new Map();
    const reach = (svc, fn) => {
      const k = `${svc.file}\t${fn}`;
      if (!reachCache.has(k)) reachCache.set(k, reachableFns(svc, fn));
      return reachCache.get(k);
    };
    const collect = (union, trigger, handler) => {
      const record = (op, c) => {
        const cur = hits.get(op.operationId) || { op, triggers: new Set(), handlers: new Set(), fn: c.fn, text: '' };
        if (trigger) cur.triggers.add(trigger);
        cur.handlers.add(handler);
        if (!cur.text && trigger) cur.text = trigger;
        cur.fn = cur.fn || c.fn;
        hits.set(op.operationId, cur);
      };
      const takeOp = (c) => {
        const op = opIndex.get(`${c.verb} ${normalize(c.path)}`);
        if (op && op.operationId) { record(op, c); return; }
        // **路径不在契约里。**
        //
        // 第一版在这里 `continue` —— 静默丢掉。后果不是「少一行」，是 /pages 的
        // 「页面调了而契约没有」那一桶**恒为 0，且没人能看出它是空的还是坏的**。
        // 实测有一条真的：`utils/auth.js` 调 `POST /dev/session`（测试后端专用），
        // 契约里没有它。所以现在记下来，让它自己显形。
        offContract.push({ screen: p.name, verb: c.verb, path: c.path, line: c.line, fn: c.fn });
      };
      for (const m of union.matchAll(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
        const svc = byAlias.get(m[1]);
        if (!svc) continue;
        const fns = reach(svc, m[2]);
        for (const c of svc.calls.filter((x) => fns.has(x.fn))) takeOp(c);
      }
      // 动态派发 `training[action](...)`：名字在运行时才定，正则抓不到被调的函数。
      // 退一步只认**本页出现过的字面量**，两条路：
      //   ① 字面量是 service 的导出函数名（training-detail 的 'register'／'cancel'）
      //   ② 字面量是动作键（`c.action`，如 'training_participation.register'）
      // 比「整个 service 全算上」准得多 —— training.js 有 12 次 api 调用，本页只用到 2 个。
      for (const m of union.matchAll(/([A-Za-z_$][\w$]*)\s*\[/g)) {
        const svc = byAlias.get(m[1]);
        if (!svc) continue;
        const literals = new Set([...union.matchAll(/'([\w.]+)'/g)].map((x) => x[1]));
        for (const name of literals) {
          if (!svc.exported.includes(name)) continue;
          for (const c of svc.calls.filter((x) => reach(svc, name).has(x.fn))) takeOp(c);
        }
        for (const c of svc.calls) if (c.action && literals.has(c.action)) takeOp(c);
      }
    };

    // 一趟：wxml 上挂的 handler（带触发语）
    for (const n of nodes) {
      for (const ev of eventsOf(n.attrs)) {
        if (!ev.handler || ev.handler.includes('{{')) continue;
        collect(unionBody(page, ev.handler), (n.text || '').replace(/\s+/g, ' ').trim(), ev.handler);
      }
    }
    // 二趟：生命周期自己发起的读（没有触发语）
    for (const h of ['onLoad', 'onShow', 'onReady', 'onPullDownRefresh', 'onReachBottom']) {
      if (page.methods.has(h)) collect(unionBody(page, h), '', h);
    }

    for (const [opId, hit] of hits) {
      const trigger = [...hit.triggers][0] || '';
      const proto1 = matchPrototype(protoTexts, trigger, proto !== null);
      const fn = [...hit.handlers][0];
      genRows.push({
        screen: p.name,
        mp_file: (screensTsv.get(p.name) || {}).mp_file || `miniprogram/pages/${p.name}/index.wxml`,
        screen_title: p.title,
        state: stateOf({ handler: fn, trigger, op: hit.op }),
        operation_id: opId,
        method: hit.op.method,
        path: hit.op.path,
        source: 'gen',
        trigger_wxml: trigger,
        trigger_prototype: proto1.text,
        trigger_flag: proto1.flag,
        gap: '',
        notes: `handler ${fn}()`,
      });
      if (!callsOfOp.has(opId)) callsOfOp.set(opId, new Map());
      callsOfOp.get(opId).set(p.name, trigger);
    }
  }

  // ── 离契约的调用也写成行，让「页面调了而契约没有」那一桶有事实来源 ────────
  // 去重：同一屏、同一 verb+path 只留一行；把来源行号收集到 notes 里。
  const offRows = (() => {
    const byKey = new Map();
    for (const o of offContract) {
      const k = `${o.screen}\t${o.verb}\t${o.path}`;
      if (!byKey.has(k)) byKey.set(k, { ...o, where: [] });
      byKey.get(k).where.push(`${o.fn}():${o.line}`);
    }
    return [...byKey.values()].map((o) => ({
      screen: o.screen,
      mp_file: o.screen === '(utils)' ? `miniprogram/${o.file}` : (screensTsv.get(o.screen) || {}).mp_file || `miniprogram/pages/${o.screen}/index.wxml`,
      screen_title: o.screen === '(utils)' ? 'utils（不经页面）' : titles.get(o.screen) || o.screen,
      state: '',
      operation_id: '',
      method: o.verb,
      path: o.path,
      source: 'off-contract',
      trigger_wxml: '', trigger_prototype: '', trigger_flag: '',
      gap: '契约里没有这条路径',
      notes: `${[...new Set(o.where)].join(', ')}`,
    }));
  })();

  // ── 写 screen-operations.tsv ─────────────────────────────────────────────
  const screenOpsPath = join(SPEC, 'screen-operations.tsv');
  const old = readTsv(screenOpsPath);
  const keepRow = (r) => r.source && r.source !== 'gen' && r.source !== 'stale' && r.source !== 'off-contract';
  const humanRows = old.filter(keepRow);
  // **键是 `screen + operation_id`，不含 state。**
  // 第一版把 state 写进键，于是在调了 state 的判据之后、128 个 gen 行全部匹配不上，
  // 一次全被标成 stale —— 一个「改了 A 就把 B 报成坏」的假警报。
  // 行身份是「哪一屏调哪个操作」；state 是它的一个属性，不是身份的一部分。
  const rowKey = (r) => `${r.screen}\t${r.operation_id}`;
  const oldGen = new Map(old.filter((r) => !keepRow(r) && r.source !== 'off-contract').map((r) => [rowKey(r), r]));
  const newKeys = new Set(genRows.map(rowKey));
  const staleRows = [...oldGen.entries()]
    .filter(([k]) => !newKeys.has(k))
    .map(([, r]) => ({ ...r, source: 'stale', notes: `${r.notes || ''} 本轮不再出现`.trim() }));
  const screenRows = [...humanRows, ...genRows, ...staleRows, ...offRows];

  // 排序：屏幕目录名 → 状态 → 操作
  screenRows.sort((a, b) => a.screen.localeCompare(b.screen) || a.state.localeCompare(b.state) || a.operation_id.localeCompare(b.operation_id));
  writeFileSync(screenOpsPath, tsv(HEAD_SCREEN_OPS, screenRows));

  // ── 写 operation-eli10.tsv ───────────────────────────────────────────────
  const eliPath = join(SPEC, 'operation-eli10.tsv');
  const oldEli = new Map(readTsv(eliPath).map((r) => [r.key, r]));
  const eliRows = ops.map((o) => {
    const key = o.operationId || `${o.method} ${o.path}`;
    const prior = oldEli.get(key) || {};
    const claimed = callsOfOp.get(o.operationId);
    const viaUtils = utilsCallers.get(o.operationId);
    let callLine;
    if (claimed && claimed.size) callLine = `调用: ${[...claimed.keys()].join(', ')}`;
    else if (viaUtils) callLine = `调用: 无页面调用（由 ${[...viaUtils].join(', ')} 内部调）`;
    else if (o.roles.includes('teacher') || o.isPublic) callLine = '调用: 无（没有页面调用它）';
    else callLine = '调用: 本轮未覆盖（家长端／管理端）';
    const touched = [...(tablesOfOp.get(o.operationId) || [])]
      .flatMap((t) => [...(screensOfTable.get(t) || [])]);
    const uniq = [...new Set(touched)].filter((n) => !(claimed && claimed.has(n))).sort();
    const lines = [callLine];
    if (uniq.length) lines.push(`影响: ${uniq.join(', ')}`);
    return {
      key,
      幹嘛: prior['幹嘛'] || '',
      怎麼走: prior['怎麼走'] || '',
      碰到誰: lines.join('\n'),
      derived_from: `${o.method} ${o.path}`,
    };
  });
  writeFileSync(eliPath, tsv(HEAD_ELI10, eliRows));

  // ── 计数（decision.md 的三条验收里，前两条） ─────────────────────────────
  const perScreen = new Map();
  for (const r of screenRows) perScreen.set(r.screen, (perScreen.get(r.screen) || 0) + 1);
  const noRow = pages.filter((p) => !perScreen.has(p.name)).map((p) => p.name);
  const teacherOps = ops.filter((o) => o.roles.includes('teacher') || o.isPublic);
  const unclaimed = teacherOps.filter((o) => !(callsOfOp.get(o.operationId) || new Map()).size && !utilsCallers.has(o.operationId));
  const viaUtils = teacherOps.filter((o) => !(callsOfOp.get(o.operationId) || new Map()).size && utilsCallers.has(o.operationId));
  const needEli = eliRows.filter((r) => !r['幹嘛']).length;

  console.log(`screen-operations.tsv  ${screenRows.length} 行（gen ${genRows.length}／人工 ${humanRows.length}／stale ${staleRows.length}／off-contract ${offRows.length}）→ ${screenOpsPath}`);
  console.log(`  state 留空 ${genRows.filter((r) => !r.state).length}/${genRows.length}（留空 = 信号不明确，不是漏填）`);
  console.log(`operation-eli10.tsv     ${eliRows.length} 行，其中待起草 ${needEli}`);
  console.log('');
  console.log(`① 55 屏有行的：${pages.length - noRow.length}/${pages.length}${noRow.length ? ` —— 缺：${noRow.join(', ')}` : ''}`);
  console.log(`② 教师可达操作有「调用」结论的：${teacherOps.length - unclaimed.length}/${teacherOps.length}`);
  console.log(`③ 无人认领（教师可达、没有屏幕调用、也不由 utils 调）：${unclaimed.length}`);
  for (const o of unclaimed) console.log(`     ${o.method} ${o.path}  ${o.operationId}`);
  for (const o of viaUtils) console.log(`   经 utils（不算缺）: ${o.method} ${o.path}  ${o.operationId}  ← ${[...utilsCallers.get(o.operationId)].join(', ')}`);
  // 第四桶。**必须打印条数** —— 第一版把它静默丢掉，于是那一桶恒为 0 而没人看得出来。
  console.log(`④ 客户端调了、契约里没有的路径：${offRows.length}${offRows.length ? '' : '（真的没有；这个数不是假的，因为丢掉的调用现在会记行）'}`);
  for (const r of offRows) console.log(`     ${r.screen}  ${r.method} ${r.path}  ← ${r.notes}`);
  for (const r of staleRows) console.log(`   stale: ${r.screen} ${r.operation_id} ${r.state}`);
  return { screenRows, eliRows, staleRows, noRow, unclaimed, needEli, offRows, stateBlank: genRows.filter((r) => !r.state).length, genCount: genRows.length };
}
