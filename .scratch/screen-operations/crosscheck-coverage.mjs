// 交叉核：同事的 coverage.md（人工审核线的页面覆盖）vs 我的 screen-operations.tsv。
// 两边是独立做出来的，对不上就是信号。
import { readFileSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const BACKEND = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';

// 他们的表：| `dir` | 当前配置标题 | 直接引用service | 审核草案 |
const cov = readFileSync(`${REPO}/.scratch/manual-page-review-2026-09-11/coverage.md`, 'utf8');
const theirs = new Map();
for (const m of cov.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|\s*([^|]*?)\s*\|\s*([是否])\s*\|/gm)) {
  theirs.set(m[1], { title: m[2], requiresService: m[3] === '是' });
}

// 我的表
const tsv = (p) => {
  const L = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
  const H = L[0].split('\t');
  return L.slice(1).filter(Boolean).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [H[i], v ?? ''])));
};
const mine = tsv(`${BACKEND}/db/spec/screen-operations.tsv`);
const byScreen = new Map();
for (const r of mine) {
  if (!byScreen.has(r.screen)) byScreen.set(r.screen, []);
  byScreen.get(r.screen).push(r);
}
const myTitle = tsv(`${BACKEND}/db/spec/screen-operations.tsv`)[0] ? null : null;

console.log(`他们的覆盖表 ${theirs.size} 屏；我的表覆盖 ${byScreen.size} 屏（含 (utils) 伪屏）\n`);

console.log('=== 他们标「否」（不直接引用 service）的屏，我的表怎么记 ===');
for (const [n, t] of theirs) {
  if (t.requiresService) continue;
  const rows = (byScreen.get(n) || []).filter((r) => r.source !== 'stale');
  const kinds = [...new Set(rows.map((r) => r.source))].join('+') || '(我的表里没有)';
  const ops = rows.filter((r) => r.operation_id).map((r) => r.operation_id);
  console.log(`  ${n.padEnd(26)} ${t.title.padEnd(14)} 我的: ${kinds.padEnd(18)} ${ops.join(', ') || ''}`);
}

console.log('\n=== 他们标「是」而我的表说这屏没有真实调用（source=no-api）===');
let bad = 0;
for (const [n, t] of theirs) {
  if (!t.requiresService) continue;
  const rows = (byScreen.get(n) || []).filter((r) => r.source !== 'stale');
  if (rows.some((r) => r.source === 'no-api')) { console.log(`  ❗ ${n}`); bad++; }
}
console.log(bad ? '' : '  无 ✓');

console.log('\n=== 两边标题逐屏比 ===');
const titleMine = new Map();
for (const r of mine) titleMine.set(r.screen, { title: r.screen_title, src: r.title_source });
let diff = 0;
for (const [n, t] of theirs) {
  const m = titleMine.get(n);
  if (!m) continue;
  if (m.title !== t.title) { console.log(`  ✗ ${n.padEnd(26)} 他们「${t.title}」 vs 我「${m.title}」[${m.src}]`); diff++; }
}
console.log(diff ? `  共 ${diff} 处不同` : '  无不同 ✓');

console.log('\n=== 只有一边有的屏 ===');
const onlyTheirs = [...theirs.keys()].filter((n) => !byScreen.has(n));
const onlyMine = [...byScreen.keys()].filter((n) => n !== '(utils)' && !theirs.has(n));
console.log('  只有他们有:', onlyTheirs.join(', ') || '无');
console.log('  只有我有:', onlyMine.join(', ') || '无');
