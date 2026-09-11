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
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, operations } from '../openapi-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BACKEND = resolve(REPO, '..', 'hualong-backend');
const SPEC = join(BACKEND, 'db', 'spec');

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
export function readTsv(path) {
  if (!existsSync(path)) return [];
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
  const unusedNoService = new Set();
  const wiringJson = join(REPO, 'docs', 'audit', `wiring-${new Date().toISOString().slice(0, 10)}.json`);
  const wiringFallback = [...(existsSync(wiringJson) ? [wiringJson] : [])];
  for (const f of wiringFallback) {
    try {
      for (const u of JSON.parse(read(f)).contractUnused || []) unusedNoService.add(u.path);
    } catch { /* 报告不在就跳过，不编 */ }
  }

  return { screenOps, byScreen, eli10, ops, opById, titles, callers, unused, notTeacher, unusedNoService };
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
