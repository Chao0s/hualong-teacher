/**
 * 装载两份新表与契约，算成 /pages 要的形状。
 *
 * 三处视图（/pages、/pages.yaml、/roles 的新列）共用这一份计算，不各算一遍。
 *
 * 四桶的定义（decision.md 的 2026-09-11 一条）：
 *   ① 已实作        页面调了、契约也有
 *   ② 页面要用而契约没有   页面调了、契约没有（planned 行的来源）
 *   ③ 契约有而页面没调     契约里有、没有任何教师屏调用
 *   ④ 页面调了而契约没有   同 ② —— ②④ 在数据上是同一件事，视图里合并成一列
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, operations } from '../openapi-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

/**
 * 后端仓库在哪 —— 与 `../openapi-source.mjs` 同一套候选，不另立一套。
 *
 * **为什么不能只写兄弟目录。** 本地后端在 `../hualong-backend`，但 CI（`.github/workflows/pages.yml`）
 * 把契约 checkout 到 `$GITHUB_WORKSPACE/contract`，并用 `HUALONG_OPENAPI` 指过去。
 * 只认兄弟目录的话，CI 上这两份表**找不到**。
 *
 * 而找不到时**必须当场失败**（CLAUDE.md §7.3：「要么只有一份，要么当场失败」）。
 * 第一版这里 `if (!existsSync) return []` —— 静默返回空表，于是线上那份 `/pages` 打出
 * 「0 屏有记录、105 条无人认领」，长得像一份报告，其实是没读到数据。**空与坏长得一样，
 * 比报错更贵。**
 */
function backendRoot() {
  const candidates = [
    // HUALONG_OPENAPI 是 `…/hualong-backend/api/openapi.yaml`，往上**一层**就是后端根
    // （`api` 的父目录）。写过两层，于是 CI 上推出的是工作区根，白试一个候选；
    // 而本地那次「CI 模拟」因为兄弟目录兜住了，**假通过** —— 见下面 usedFrom()。
    process.env.HUALONG_OPENAPI && resolve(dirname(process.env.HUALONG_OPENAPI), '..'),
    resolve(REPO, '..', 'hualong-backend'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, 'db', 'spec', 'screen-operations.tsv'))) return c;
  }
  throw new Error(
    '找不到 hualong-backend（要 db/spec/screen-operations.tsv 与 operation-eli10.tsv）。已尝试：\n' +
    candidates.map((c) => `  ${c}`).join('\n') +
    '\n本地：把 hualong-backend 放在 hualong-teacher 旁边。' +
    '\nCI：workflow 的 sparse-checkout 必须带上那两份 tsv（见 .github/workflows/pages.yml）。',
  );
}
const BACKEND = backendRoot();
const SPEC = join(BACKEND, 'db', 'spec');

/**
 * 读的是哪一份后端，以及怎么找到的。
 *
 * **为什么要打出来**：本机永远有兄弟目录兜着，所以「CI 上到底读没读到」在本机测不出来 ——
 * 我第一版就是这么假通过一次。把来源印出来，本机就能对着它断言「这次走的是
 * HUALONG_OPENAPI 那条路，不是兜底」。与 `spec-inventory.mjs` 第一行印契约绝对路径同一个用意。
 */
export function usedFrom() {
  return process.env.HUALONG_OPENAPI && BACKEND === resolve(dirname(process.env.HUALONG_OPENAPI), '..')
    ? { root: BACKEND, how: 'HUALONG_OPENAPI' }
    : { root: BACKEND, how: '兄弟目录 ../hualong-backend' };
}

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** 读 tsv。**文件不在就抛**，不返回空表 —— 理由见上面 backendRoot() 的注释。 */
export function readTsv(path) {
  if (!existsSync(path)) throw new Error(`读不到 ${path}（空表与坏表长得一样，所以这里不静默）`);
  const lines = read(path).trimEnd().split('\n');
  const head = lines[0].split('\t');
  return lines.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
}

/** 页面中文标题：各页 index.json 的 navigationBarTitleText 是权威。 */
export function screenTitles() {
  const app = JSON.parse(read(join(REPO, 'miniprogram', 'app.json')));
  const out = new Map();
  for (const p of app.pages) {
    const name = p.split('/')[1];
    const f = join(REPO, 'miniprogram', p.replace(/\/index$/, ''), 'index.json');
    let title = name;
    if (existsSync(f)) { try { title = JSON.parse(read(f)).navigationBarTitleText || name; } catch { /* 坏 json 就用目录名 */ } }
    out.set(name, title);
  }
  return out;
}

export function buildPageView() {
  const screenOps = readTsv(join(SPEC, 'screen-operations.tsv'));
  const eli10 = new Map(readTsv(join(SPEC, 'operation-eli10.tsv')).map((r) => [r.key, r]));
  const ops = operations(loadSpec());
  const titles = screenTitles();
  const opById = new Map(ops.map((o) => [o.operationId, o]));

  // 屏幕 → 它的行，按状态排
  const byScreen = new Map();
  for (const r of screenOps) {
    if (!byScreen.has(r.screen)) byScreen.set(r.screen, []);
    byScreen.get(r.screen).push(r);
  }
  for (const list of byScreen.values()) {
    list.sort((a, b) => a.state.localeCompare(b.state) || (a.operation_id || '').localeCompare(b.operation_id || ''));
  }

  // 每条操作被哪些屏调用（由 碰到誰 的 `调用:` 行倒读，与生成器同源）
  //
  // **带 gap 的行不算「调用」。** 一条 `human` + gap 的行说的是「这一屏该调 X 而没调」，
  // 那是缺陷记录；算成调用会把 X 从「无人认领」里抹掉，正好把要修的问题藏起来
  // （coordination-file-list 的 listCoordDocuments／getCoordDocument 撞过这一次：
  // 无人认领 10 条变 8 条，少掉的两条恰恰是契约里闲置、页面该调的那两条）。
  const callers = new Map();
  for (const r of screenOps) {
    if (!r.operation_id) continue;
    if ((r.gap || '').trim()) continue;
    if (!callers.has(r.operation_id)) callers.set(r.operation_id, new Set());
    callers.get(r.operation_id).add(r.screen);
  }

  const teacherOps = ops.filter((o) => (o.roles || []).includes('teacher') || o.isPublic);
  // 「无人认领」= 教师可达，且**没有任何页面、也没有 utils 内部调**。
  // 后一半要从 ELI10 的「碰到誰」读：`utils/auth.js` 调的 `GET/POST /auth/session` 不在这份表里，
  // 只按「表里有没有」数会把它们错报成无人认领（10 变 12，那两条是假发现）。
  const viaUtils = new Set([...eli10.values()]
    .filter((r) => (r['碰到誰'] || '').includes('由 utils/'))
    .map((r) => r.key));
  const unused = teacherOps.filter((o) => !callers.has(o.operationId) && !viaUtils.has(o.operationId));
  const notTeacher = ops.filter((o) => !(o.roles || []).includes('teacher') && !o.isPublic);

  // 无页面认领的那 10 条里，哪些 service 层写了却没有任何页面走得到（scan:wiring 报 6，
  // 差的 4 条就是这个）—— 两者都要报，因为它们要修的东西不一样。
  //
  // 报告取 `docs/audit/` 下**最新**的一份 wiring-*.json，不按今天的日期拼文件名：
  // 拼日期的话，报告不是今天就静默落空，而这一列会从「两条都没写」翻成
  // 「service 层写了、没有页面走得到」—— **静默降级成一句错的**，比空着更坏。
  // 读不到就不猜：`serviceReport` 返回 null，视图那一列照实说「没读到裁决报告」。
  const auditDir = join(REPO, 'docs', 'audit');
  const wiringFile = existsSync(auditDir)
    ? readdirSync(auditDir).filter((f) => /^wiring-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop()
    : null;
  const unusedNoService = new Set();
  if (wiringFile) {
    for (const u of JSON.parse(read(join(auditDir, wiringFile))).contractUnused || []) {
      unusedNoService.add(u.path);
    }
  }

  return {
    screenOps, byScreen, eli10, ops, opById, titles, callers, unused, notTeacher,
    unusedNoService, serviceReport: wiringFile,
  };
}

/**
 * 派生 spec：167 个操作全保留，按屏幕分组（tag = 屏幕中文标题），
 * 无认领的进两组 —— 「无人认领」与「本轮未覆盖」（家长端／管理端）。
 * 同一操作在认领它的每一屏下都出现一次（搜得到），这是刻意的。
 */
export function screenGroupedSpec() {
  const spec = loadSpec();
  const { callers, titles, byScreen } = buildPageView();
  const tags = [];
  const seenTag = new Set();
  // tag 用**屏幕名**，从 byScreen 取（callers 的键是 operationId，方向是反的）。
  for (const screen of [...byScreen.keys()].sort()) {
    const t = titles.get(screen) || screen;
    if (!seenTag.has(t)) { seenTag.add(t); tags.push({ name: t, description: `屏幕 ${screen}（miniprogram/pages/${screen}/）` }); }
  }
  const noClaim = '无人认领（教师可达，没有页面调用）';
  const notCovered = '本轮未覆盖（家长端／管理端）';
  const utilsTag = '由 utils 内部调用（不属任何屏幕）';
  tags.push({ name: noClaim, description: '教师能调，但没有任何教师屏调它 —— 这一组本身就是一条发现' });
  tags.push({ name: notCovered, description: '本轮只映射教师端 55 屏，这些操作的屏幕在别的端' });
  tags.push({ name: utilsTag, description: '例如 utils/auth.js 的登录那一发：没有屏幕直接调它，但它在用' });

  const screenOfOp = new Map();
  for (const [opId, set] of callers) screenOfOp.set(opId, [...set].map((s) => titles.get(s) || s).sort());
  // 与 buildPageView 同一判据：由 utils 内部调的不算「无人认领」。
  const viaUtils = new Set([...buildPageView().eli10.values()]
    .filter((r) => (r['碰到誰'] || '').includes('由 utils/'))
    .map((r) => r.key));

  const paths = {};
  for (const [p, item] of Object.entries(spec.paths || {})) {
    const clone = JSON.parse(JSON.stringify(item));
    for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = clone[m];
      if (!op) continue;
      const groups = screenOfOp.get(op.operationId);
      const isTeacher = (op['x-hualong-roles'] || []).includes('teacher');
      const isPreSession = Array.isArray(op.security) && op.security.length === 0;
      // 顺序是有意的：先问「有没有屏幕调」，再问「是不是 utils 内部调」。
      // 后者不能要求 isTeacher —— `POST /auth/session` 的角色的是空的（登录前公开），
      // 要求 isTeacher 会把它漏到「无人认领」那一组里，那就是一条假发现。
      if (groups && groups.length) op.tags = groups;
      else if (viaUtils.has(op.operationId)) op.tags = [utilsTag];
      else if (isTeacher || isPreSession) op.tags = [noClaim];
      else op.tags = [notCovered];
    }
    paths[p] = clone;
  }
  return { ...spec, tags, paths };
}
