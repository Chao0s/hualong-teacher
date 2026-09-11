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

/** 取 `function NAME(...) { ... }` 的整段函数体（花括号配平）。取不到返回空串。 */
function bodyOf(src, name) {
  const re = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return '';
  const open = src.indexOf('{', m.index);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
    else if (ch === '`') { const j = src.indexOf('`', i + 1); i = j < 0 ? src.length : j; }
    else if (ch === "'" || ch === '"') { const j = src.indexOf(ch, i + 1); i = j < 0 ? src.length : j; }
    else if (ch === '/' && src[i + 1] === '/') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; }
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

/** 机器猜的屏幕状态。**一律带问号** —— 猜的和看出来的必须分得开。 */
function guessState(fn, handler, text) {
  const s = `${fn} ${handler} ${text}`;
  if (/delete|remove|delete|lock|withdraw|finalize|revoke|撤回|删除|锁定|定稿/.test(s)) return 'dialog?';
  if (/save|publish|create|submit|update|patch|release|remind|collect|upload|发布|提交|保存|新建|上传|提醒|征集/.test(s)) return 'form?';
  if (/detail|Detail|get[A-Z]|详情|预览/.test(s)) return 'detail?';
  if (/list|List|roster|Roster|search|filter|列表|搜索|筛选/.test(s)) return 'list?';
  return 'list?';
}

const tableTokens = (s) => [...String(s || '').matchAll(/db_[a-z0-9_]+/g)].map((m) => m[0]);

const tsv = (head, rows) => `${[head, ...rows.map((r) => head.map((h) => String(r[h] ?? '').replace(/[\t\r\n]/g, ' ')))].map((c) => c.join('\t')).join('\n')}\n`;

function readTsv(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
  const head = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
}

/** 原型按钮文案里找触发语的对应句。返回 {text, flag}。 */
function matchPrototype(protoTexts, trigger) {
  if (!trigger) return { text: '', flag: '' };
  if (protoTexts.includes(trigger)) return { text: trigger, flag: '' };
  for (const t of protoTexts) {
    for (let i = 0; i + 3 <= trigger.length; i++) {
      if (t.includes(trigger.slice(i, i + 3))) return { text: t, flag: '文案不同' };
    }
  }
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
  const utilsCallers = new Map();
  if (utilsDir && existsSync(utilsDir)) {
    for (const f of readdirSync(utilsDir).filter((x) => x.endsWith('.js'))) {
      const u = scanService(join(utilsDir, f));
      for (const c of u.calls) {
        const op = opIndex.get(`${c.verb} ${normalize(c.path)}`);
        if (!op || !op.operationId) continue;
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
        if (op && op.operationId) record(op, c);
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
      const proto1 = matchPrototype(protoTexts, trigger);
      const fn = [...hit.handlers][0];
      genRows.push({
        screen: p.name,
        mp_file: (screensTsv.get(p.name) || {}).mp_file || `miniprogram/pages/${p.name}/index.wxml`,
        screen_title: p.title,
        state: guessState(hit.fn, fn, trigger),
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

  // ── 写 screen-operations.tsv ─────────────────────────────────────────────
  const screenOpsPath = join(SPEC, 'screen-operations.tsv');
  const old = readTsv(screenOpsPath);
  const keepRow = (r) => r.source && r.source !== 'gen' && r.source !== 'stale';
  const humanRows = old.filter(keepRow);
  const oldGen = new Map(old.filter((r) => !keepRow(r)).map((r) => [`${r.screen}\t${r.operation_id}\t${r.state}`, r]));
  const newKeys = new Set(genRows.map((r) => `${r.screen}\t${r.operation_id}\t${r.state}`));
  const staleRows = [...oldGen.entries()]
    .filter(([k]) => !newKeys.has(k))
    .map(([, r]) => ({ ...r, source: 'stale', notes: `${r.notes || ''} 本轮不再出现`.trim() }));
  const screenRows = [...humanRows, ...genRows, ...staleRows];

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

  console.log(`screen-operations.tsv  ${screenRows.length} 行（gen ${genRows.length}／人工 ${humanRows.length}／stale ${staleRows.length}）→ ${screenOpsPath}`);
  console.log(`operation-eli10.tsv     ${eliRows.length} 行，其中待起草 ${needEli}`);
  console.log('');
  console.log(`① 55 屏有行的：${pages.length - noRow.length}/${pages.length}${noRow.length ? ` —— 缺：${noRow.join(', ')}` : ''}`);
  console.log(`② 教师可达操作有「调用」结论的：${teacherOps.length - unclaimed.length}/${teacherOps.length}`);
  console.log(`③ 无人认领（教师可达、没有屏幕调用、也不由 utils 调）：${unclaimed.length}`);
  for (const o of unclaimed) console.log(`     ${o.method} ${o.path}  ${o.operationId}`);
  for (const o of viaUtils) console.log(`   经 utils（不算缺）: ${o.method} ${o.path}  ${o.operationId}  ← ${[...utilsCallers.get(o.operationId)].join(', ')}`);
  for (const r of staleRows) console.log(`   stale: ${r.screen} ${r.operation_id} ${r.state}`);
  return { screenRows, eliRows, staleRows, noRow, unclaimed, needEli };
}
