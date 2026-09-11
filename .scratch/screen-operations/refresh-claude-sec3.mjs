// CLAUDE.md §3 刷新到实测：三个数、扫描器引文、判据那句、中转页那句、表补 14 行。
import { readFileSync, writeFileSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const F = `${REPO}/CLAUDE.md`;
const crlf = (s) => s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
let t = readFileSync(F, 'utf8').replace(/\r\n/g, '\n');
const orig = t;

// 每页的标题与走法，取自扫描器报告（`context.path` 就是「怎么走到」那一列要的）
const json = JSON.parse(readFileSync(`${REPO}/docs/audit/wiring-2026-09-11.json`, 'utf8'));
const info = new Map(json.pages.map((p) => [p.name, { title: p.title || '', path: String((p.context || {}).path || '').replace(/\n/g, ' ').trim() }]));

const rows = [
  'assessment-tool', 'resource-detail', 'case-detail',
  'party-study-detail', 'party-activity-detail', 'party-brand-detail',
  'teacher-term-evaluation', 'teacher-term-form',
  'teacher-message', 'teacher-message-detail',
  'growth-comprehensive-assessment', 'comprehensive-assessment-form',
  'comprehensive-assessment-report', 'comprehensive-assessment-class-report',
];
const missing = rows.filter((n) => !t.includes(`| \`${n}\``));
const newRows = missing.map((n) => {
  const i = info.get(n) || {};
  return `| \`${n}\` | ${i.title} | ${i.path} |`;
}).join('\n');

const edits = [
  ['`miniprogram/` 共 **55 页**，**46 页已接 API**，**9 页仍是写死的字面量**。',
   '`miniprogram/` 共 **56 页**，**48 页已接 API**，**8 页仍是写死的字面量**。'],

  ['权威是 `npm run scan:wiring` 第一行的「页面 55（已接 46）」，不是本节（2026-09-10 实测）。',
   '权威是 `npm run scan:wiring` 第一行的「页面 56（已接 48）」，不是本节（2026-09-12 实测）。'],

  ["判断某一页属于哪一类：看 `index.js` 里有没有 `require('../../services/`。",
   "判断某一页属于哪一类：看它**真的调用过** `services/*` 吗 —— **`require` 了不算**。\n`home-school` 就 `require` 了 `co-education` 却一次都没调用（后来才接上），按 `require` 数会把它算成已接。\n两种数法今天恰好一致，但判据要按调用，与扫描器一致。"],

  ['**已接 API 的 36 页**，加上路径上必经、\n**本身还没接 API 的 4 个中转页**（`home-school`、`growth-record`、`teacher-evaluation`、\n`training-center`，逐个在表里标了），走法如下：',
   '**已接 API 的 48 页**，加上路径上必经、\n**本身还没接 API 的 4 个中转页**（`comprehensive-coordination`、`coordination-file-list`、\n`resource-center`、`training-center`，逐个在表里标了），走法如下：'],
];

for (const [from, to] of edits) {
  if (!t.includes(from)) { console.error(`FAIL 找不到：${from.slice(0, 50)}…`); process.exit(1); }
  t = t.replace(from, to);
}

// 表尾那一行之后追加缺的行
const anchor = '| `teacher-profile` | 个人档案 | 教研培训 → 个人档案（「我的档案」那一格） |';
if (!t.includes(anchor)) { console.error('FAIL 找不到表尾'); process.exit(1); }
if (!newRows) { console.error('FAIL 没有要补的行（已包含）'); process.exit(1); }
t = t.replace(anchor, `${anchor}\n${newRows}`);

if (t === orig) { console.error('FAIL 什么都没改'); process.exit(1); }
writeFileSync(F, crlf(t));
console.log(`OK  补了 ${newRows.split('\n').length} 行；孤立 LF ${(t.match(/(?<!\r)\n/g) || []).length}`);
