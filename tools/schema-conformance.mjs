/**
 * 客户端用的字段名，对数据库真实列名的逐字核对。
 *
 * Run:  npm run verify:schema
 * Exit: 0 clean, 1 with findings.
 *
 * ── 为什么这个检查存在 ────────────────────────────────────────────────────────
 *
 * 契约一致性此前只对着 `openapi.yaml` 查。那能抓住「路径不存在」，抓不住
 * 「字段名拼错了一个字母」—— 那种请求会被服务端当作未知字段忽略（§7.3 的派生
 * 字段就是被忽略而不报错的），或者读回来永远是 undefined，界面上表现为一处空白。
 * 空白不会让任何测试变红。
 *
 * AGENTS.md 第 1 条写着：`hualong-backend/db/01_schema.sql` 是**唯一的字段级权威**，
 * 本仓库刻意不复制它。所以这个检查读那份 DDL，不读任何副本。
 *
 * ── 它查什么、不查什么 ──────────────────────────────────────────────────────
 *
 * 查   客户端服务层里出现的、看起来像列名的标识符，是否**两个权威里至少有一个**
 *      认识它：`01_schema.sql` 的列名，或 `openapi.yaml` 的 schema 属性名
 * 不查 它是不是**那张**表的列 —— 那要跨端点追踪类型，超出一个字符串检查能做的事
 *
 * 两个权威缺一不可。只查列名会把服务端派生的响应字段全部误报 ——
 * `content_fingerprint`、`total_pages`、`assessed_child_count` 都是算出来的，
 * 不是存着的。只查契约会漏掉契约本身没写全的地方，而那正是本仓库已经登记了
 * 七处的东西。
 *
 * 所以它抓的是「这个名字在 62 张表和 149 个操作的模式里都不存在」——那是拼写
 * 漂移或凭空发明。剩下的误报由 ENVELOPE 与 CLIENT_OWN 两张豁免表压住。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SERVICES = resolve(REPO, 'miniprogram', 'services');

const SCHEMA_CANDIDATES = [
  process.env.HUALONG_SCHEMA,
  resolve(REPO, '..', 'hualong-backend', 'db', '01_schema.sql'),
  'G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/db/01_schema.sql',
].filter(Boolean);

/**
 * 信封与约定字段。它们是契约层的，不是任何一张表的列（§2.1／§3.1／§4）。
 */
const ENVELOPE = new Set([
  'items', 'next_cursor', 'cursor', 'limit', 'code', 'message', 'request_id',
  'details', 'field', 'rule', 'error', 'data', 'header', 'method', 'url',
  'session_token', 'expires_at', 'surface', 'role', 'subject', 'scope',
  'permissions', 'current_term', 'js_code', 'phone_code',
]);

/**
 * 客户端自己造的、只在界面上活着的名字。它们**必须**不是列名 —— 一个渲染用的
 * `status_label` 若与某张表的列同名，下一个人会以为它是服务端给的。
 */
const CLIENT_OWN = [
  // 渲染用的派生值。服务端给码，客户端给字。
  /_note$/,
  /_label$/, /_pill$/, /_text$/, /_texts$/, /_class$/, /^thumb_/,
  // 界面状态与表单配置。它们只在 setData 里活着，一次也不上线。
  /^error/, /^loading/, /^can[A-Z_]/, /^has_/, /_done$/, /_multi$/,
  /_notice$/, /_reason$/, /_count$/, /_lead$/, /_summary$/, /_title$/, /_body$/,
  // 日期与时间在表单上是两个控件，提交前合成一个带字面偏移量的 `*_at`。
  // 拆分只在界面，线上走的仍是白名单里的那个列名（§1.2）。
  /^start_time$/, /^due_time$/, /^due_date$/, /^start_date$/,
  // 页面路由参数。`navigateTo?content_id=12` 不是 API 查询参数，不上线。
  /^content_id$/, /^target$/,
];
const isClientOwn = (name) => CLIENT_OWN.some((re) => re.test(name));

function schemaPath() {
  for (const c of SCHEMA_CANDIDATES) if (existsSync(c)) return c;
  throw new Error(`找不到 01_schema.sql。已尝试：\n  ${SCHEMA_CANDIDATES.join('\n  ')}`);
}

/** 62 张表的全部列名，外加表名本身（`owner_object` 之类会用到）。 */
function schemaNames() {
  const sql = readFileSync(schemaPath(), 'utf8');
  const names = new Set();
  let table = null;
  for (const line of sql.split('\n')) {
    const create = /^CREATE TABLE\s+([a-z_0-9]+)/i.exec(line);
    if (create) { table = create[1]; names.add(table); continue; }
    if (!table) continue;
    if (/^\);/.test(line)) { table = null; continue; }
    // `  column_name TYPE ...` —— 约束行以 CONSTRAINT/PRIMARY/UNIQUE/CHECK/FOREIGN 开头。
    const col = /^\s+([a-z_0-9]+)\s+[A-Z]/.exec(line);
    if (col && !/^(constraint|primary|unique|check|foreign|references)$/i.test(col[1])) {
      names.add(col[1]);
    }
  }
  // 表名去掉 `db_` 前缀也算同一个东西：客户端谈的是 `task_assign`，DDL 写的是
  // `db_task_assign`。不加这一条会把每张表都报成漂移。
  for (const n of [...names]) if (n.startsWith('db_')) names.add(n.slice(3));
  return names;
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    statSync(f).isDirectory() ? walk(f, out) : out.push(f);
  }
  return out;
}

/** 去掉注释：注释里提到一个列名是文档，不是使用。 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** 契约文件本身的位置，用来找同目录的动作登记表。 */
function specPathOf() {
  const candidates = [
    process.env.HUALONG_OPENAPI,
    resolve(REPO, '..', 'hualong-backend', 'api', 'openapi.yaml'),
    'G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/api/openapi.yaml',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('找不到 openapi.yaml');
}

/** 契约所有 schema 的属性名。服务端派生的响应字段活在这里，不在 DDL 里。 */
async function contractNames() {
  const out = new Set();
  try {
    const { loadSpec } = await import('./openapi-source.mjs');
    const spec = loadSpec();
    const visit = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (node.properties) for (const k of Object.keys(node.properties)) out.add(k);
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, depth + 1);
    };
    visit(spec.components || {});
    visit(spec.paths || {});
    // 枚举值也算。错误码（`validation_failed`）、`usage_key` 的取值（`main_file`）、
    // 预检的规则名（`section_incomplete`）都是契约定义的字符串常量，客户端持有它们
    // 是对的 —— 它们不是列，但也不是客户端发明的。
    const enums = (n, d = 0) => {
      if (!n || typeof n !== 'object' || d > 14) return;
      if (Array.isArray(n.enum)) for (const v of n.enum) if (typeof v === 'string') out.add(v);
      for (const v of Object.values(n)) if (v && typeof v === 'object') enums(v, d + 1);
    };
    enums(spec);
    // 动作键的后半段。登记表里是 `resource.update_draft`，客户端持有的是后半段。
    try {
      const tsv = readFileSync(resolve(dirname(specPathOf()), 'action-registry.tsv'), 'utf8');
      for (const line of tsv.split(/\r?\n/).slice(1)) {
        const key = line.split('\t')[0];
        if (key && key.includes('.')) out.add(key.split('.').pop());
      }
    } catch { /* 登记表缺席不影响主检查 */ }
    // 参数名也算 —— `coord_category`、`scale_code` 都是参数不是列。
    const params = (n, d = 0) => {
      if (!n || typeof n !== 'object' || d > 14) return;
      if (Array.isArray(n.parameters)) for (const q of n.parameters) if (q && q.name) out.add(q.name);
      for (const v of Object.values(n)) if (v && typeof v === 'object') params(v, d + 1);
    };
    params(spec);
  } catch (err) {
    console.error(`契约不可读，本次只对着 DDL 查：${err.message}`);
  }
  return out;
}

/**
 * 两个权威都不认识、但已经查清来历的名字。
 *
 * 与覆盖走查的拒绝表同一个形状：不是把它们藏起来，是把「为什么可以」写在旁边，
 * 于是**新出现**的名字会立刻掉进 findings 里。一张全是豁免的表等于没有检查；
 * 一张每条都带理由的表是一份账。
 */
const KNOWN = {
  // 成长册预检的问题规则词表。服务端算出来的字符串，契约一个也没定义 —— 客户端
  // 只能按 mock 的取值渲染文案。记进交接的契约缺口。
  section_incomplete: '预检规则名，契约未定义',
  collected_incomplete: '同上',
  material_without_topic: '同上',
  term_message_missing: '同上',
  page_count_over_limit: '同上',
  layout_pack_unreleased: '版式包未发布的错误码，契约未定义（ADR-0015 Follow-ups）',
  over_limit: '同上，页数超限的规则名',
  // 已登记的契约缺口，见 HANDOFF.md → 契约缺口。
  related_cases: '资源详情的服务端反向连接，契约未登记',
  related_resources: '同上，方向相反',
  todo_kind: '来自 /home/todos —— 契约里没有这个端点（2026-08-24 已登记）',
};

const names = schemaNames();
const contract = await contractNames();
const findings = [];
const seen = new Map();
const known = new Map();

for (const file of walk(SERVICES).filter((f) => extname(f) === '.js')) {
  const code = codeOnly(readFileSync(file, 'utf8'));
  const rel = relative(REPO, file).replace(/\\/g, '/');
  // `row.some_field`、`{ some_field: ... }`、`'some_field'` 三种形态里的蛇形名。
  // 只看蛇形：驼峰是客户端自己的命名，契约要求字段名与列名逐字相同、蛇形。
  for (const m of code.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) {
    const name = m[1];
    if (names.has(name) || contract.has(name) || ENVELOPE.has(name) || isClientOwn(name)) continue;
    if (KNOWN[name]) { known.set(name, KNOWN[name]); continue; }
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name).add(rel);
  }
}

for (const [name, files] of [...seen].sort()) {
  findings.push({ name, files: [...files] });
}

console.log('| 检查项 | 结果 |');
console.log('| --- | --- |');
console.log(`| 权威 | ${schemaPath()} |`);
console.log(`| 数据库标识符（列名＋表名） | ${names.size} 个 |`);
console.log(`| 契约模式属性、参数、枚举值与动作键 | ${contract.size} 个 |`);
console.log(`| 服务层文件 | ${walk(SERVICES).filter((f) => extname(f) === '.js').length} 个 |`);
console.log(`| 已查清来历的例外 | ${known.size} 个 |`);
console.log(`| 两个权威都不认识、且来历不明的字段 | ${findings.length} 个 |`);

if (known.size) {
  console.log('');
  console.log('例外（每条都有来历，新名字不会掉进这里）：');
  for (const [n, why] of [...known].sort()) console.log(`  ${n.padEnd(24)} ${why}`);
}

if (findings.length) {
  console.log('');
  console.log('以下名字在 62 张表与 149 个操作的模式里都不存在。每一条要么是拼写漂移，');
  console.log('要么是客户端自己的渲染字段（加进 CLIENT_OWN），要么说明契约漏写了它：');
  console.log('');
  for (const f of findings) console.log(`  ${f.name}\n    ${f.files.join(', ')}`);
  process.exit(1);
}
console.log('');
console.log('客户端用的每一个蛇形字段，都能在数据库列名或契约模式里找到出处。');
