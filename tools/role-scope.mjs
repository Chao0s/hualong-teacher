/**
 * 角色 × 操作 × scope 对照表。**只读，不改契约一个字节。**
 *
 * 为什么需要它：教师端与家长端可能合并成一个客户端、共用同一批 API 调用。
 * 契约其实**已经按角色分范围**了（同一路径多条 predicate），但**没有任何一处把
 * 「哪条操作、哪些角色、各自什么范围」并排列出来** —— 要人工判断「合并后会不会串角色」，
 * 就得先把这张表摆在桌上。
 *
 * 它**不改契约**：角色来自会话票，不是请求体（把角色放进请求参数就是提权面）。
 * 合并之后服务端逻辑一个字不用动；错角色的票调教师端操作按 §7.2 回 404 不回 403。
 *
 *   node tools/role-scope.mjs            -> docs/audit/role-scope-<日期>.md
 *   node tools/role-scope.mjs --stdout
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, operations, specPath } from './openapi-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const STDOUT = process.argv.includes('--stdout');

const spec = loadSpec();
const ops = operations(spec);
const raw = spec.paths;

// 契约里角色名是逻辑名（teacher / parent / admin-pc / partner-account），
// 与「哪个端」不是一对一 —— 合并客户端之后这件事正是要看的地方。
const ROLE_NOTE = {
  teacher: '教师端小程序',
  parent: '家长端小程序',
  'admin-pc': '管理端 PC 后台',
  'partner-account': '合作园帐户',
};

// 同一路径被几个「端」用到 —— 合并客户端后风险最高的一类。
const pathRoles = new Map();
for (const o of ops) {
  if (!pathRoles.has(o.path)) pathRoles.set(o.path, new Set());
  for (const r of o.roles) pathRoles.get(o.path).add(r);
}

const seg = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const rows = ops.map((o) => {
  const item = raw[o.path][o.method.toLowerCase()];
  return {
    method: o.method,
    path: o.path,
    operationId: o.operationId || '(无)',
    roles: o.roles,
    isPublic: o.isPublic,
    permission: item['x-hualong-permission'] || '',
    scope: seg(item['x-hualong-scope']),
    // 多角色的范围常常写在 description 里而不是 x-hualong-scope（listResources 就是）。
    // 不假装抓得到 —— 只标出「这里没写，去看 description」。
    scopeInDescription: !item['x-hualong-scope'] && o.roles.length > 1,
    samePathRoles: [...(pathRoles.get(o.path) || new Set())],
    blockedOn: o.blockedOn,
  };
});

const multi = rows.filter((r) => r.roles.length > 1);
const noRoles = rows.filter((r) => !r.roles.length && !r.isPublic);
const teacherReach = rows.filter((r) => r.roles.includes('teacher') || r.isPublic);
const sharedWithParent = rows.filter((r) => r.roles.includes('teacher') && r.roles.includes('parent'));

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (list, cols) => [
  `| ${cols.map((c) => c[0]).join(' | ')} |`,
  `|${cols.map(() => '---').join('|')}|`,
  ...list.map((r) => `| ${cols.map((c) => cell(c[1](r))).join(' | ')} |`),
].join('\n');

const md = `# 角色 × 操作 × scope 对照表

只读产物，**没有改动契约任何字节**。生成自 \`${specPath()}\`。

用途：教师端与家长端可能合并成一个客户端、共用同一批 API 调用。**契约已经按角色分范围**
（同一路径多条 predicate，见下表），但此前没有任何一处把它们并排列出来。这张表就是那面镜子。

**结论先说：服务端不需要为「合并」改任何东西。** 角色来自**会话票**，不是请求体 ——
把角色放进请求参数会是一条提权面。合并后错角色的票调教师端操作，按契约 §7.2 回
**404 而不是 403**（这条早已定下，见 \`/roles\` 页顶部那句）。

---

## 一、计数

| 项 | 数 |
|---|---|
| 操作总数 | ${rows.length} |
| **声明 >1 个角色的** | **${multi.length}** |
| 同时给教师端与家长端的 | **${sharedWithParent.length}** |
| 带权限码 \`x-hualong-permission\` 的 | ${rows.filter((r) => r.permission).length} |
| 写了 \`x-hualong-scope\` 的 | ${rows.filter((r) => r.scope).length} |
| **多角色但范围只写在 description 里**（机器抓不到，要人读） | **${rows.filter((r) => r.scopeInDescription).length}** |
| 无角色且非公开（**缺陷**） | ${noRoles.length} |
| 教师端可达 | ${teacherReach.length} |

角色逻辑名 → 哪个端：${Object.entries(ROLE_NOTE).map(([k, v]) => `\`${k}\` = ${v}`).join('；')}。
**逻辑名与「哪个端」不是一对一** —— 合并客户端之后这件事正是要看的地方。

---

## 二、声明了多个角色的操作（${multi.length} 条）—— 合并后风险最高的这一批

${table(multi, [
  ['方法', (r) => r.method],
  ['路径', (r) => `\`${r.path}\``],
  ['operationId', (r) => `\`${r.operationId}\``],
  ['角色', (r) => r.roles.join('、')],
  ['范围写在哪', (r) => (r.scope ? `\`x-hualong-scope\`` : r.scopeInDescription ? '**description 里（要人读）**' : '没写')],
  ['权限码', (r) => (r.permission ? `\`${r.permission}\`` : '—')],
])}

${sharedWithParent.length ? `**同时给教师端与家长端的**：${sharedWithParent.map((r) => `\`${r.method} ${r.path}\``).join('、')}。合并客户端之后，这一批是「同一支调用、两种身份」最直接的落点。` : '**没有一条同时给教师端与家长端。**'}

---

## 三、范围只写在 description 里的（${rows.filter((r) => r.scopeInDescription).length} 条）

这几条的 \`x-hualong-scope\` 是空的，逐角色的 predicate 写在散文中。**机器抓不到，人要读。**
给合并客户端做审阅时，这一批至少要逐条读一遍。

${table(rows.filter((r) => r.scopeInDescription), [
  ['方法', (r) => r.method],
  ['路径', (r) => `\`${r.path}\``],
  ['角色', (r) => r.roles.join('、')],
  ['为什么在这里', () => '多角色但无 `x-hualong-scope`，范围在 description'],
])}

---

## 四、全量清单（${rows.length} 条）

${table(rows, [
  ['方法', (r) => r.method],
  ['路径', (r) => `\`${r.path}\``],
  ['operationId', (r) => `\`${r.operationId}\``],
  ['角色', (r) => (r.isPublic ? '登录前公开' : r.roles.join('、') || '**无**')],
  ['权限码', (r) => (r.permission ? `\`${r.permission}\`` : '—')],
  ['scope', (r) => (r.scope ? `\`${r.scope.slice(0, 120)}\`` : r.scopeInDescription ? '（见 description）' : '—')],
  ['同路径角色', (r) => r.samePathRoles.join('、')],
  ['阻断', (r) => (r.blockedOn.length ? r.blockedOn.join('；') : '—')],
])}

---

## 五、这张表**不能**回答的

- **谁有权限调**：它只列契约**声明**的角色；服务端实作是否会漏判，要靠
  \`db/testdata/authz-tests/\` 那七组越权探针，不是靠这张表。
- **合并客户端后「一个人两种角色」怎么办**：那是一条**身份模型决议**，不是契约改动。
  契约今天的前提写在 \`DECISIONS.md\` A1/A2：**两个小程序、两个 AppID，角色由「开哪个 app」决定，
  不做角色切换**；而 \`db/GAPS.md\` **G1** 登记着这个模型仍缺 DDL（\`db_phone_claim\` 的
  \`ck_pc2_type\` 今天只允许 c1/c5，所以 \`surface=parent\` 实作不出来）。
  **要合并端，先改的是那两处，不是这份契约。**
- **范围判定是否真的生效**：见 \`/pages\` 与 authz 探针。
`;

const out = join(REPO, 'docs', 'audit', `role-scope-${new Date().toISOString().slice(0, 10)}.md`);
if (STDOUT) console.log(md);
else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(`写出 ${out}`);
  console.log(`  ${rows.length} 条操作；多角色 ${multi.length}；同给师/家长 ${sharedWithParent.length}；范围只在 description ${rows.filter((r) => r.scopeInDescription).length}；无角色非公开 ${noRoles.length}`);
}
