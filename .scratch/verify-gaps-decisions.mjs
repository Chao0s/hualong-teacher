// 用 node 核（不用 grep/awk —— 這一輪它們三次給錯答案）。
import { readFileSync } from 'node:fs';
const s = readFileSync('G:/My Drive/Workplace/China KG Platform/hualong-backend/db/GAPS.md', 'utf8');
const L = s.split('\n');

const G = ['G109', 'G110', 'G111', 'G112', 'G113'];
let bad = 0;

console.log('  編號   級別詞         已決那行       補充在      標題');
for (const g of G) {
  const i = L.findIndex((l) => l.startsWith(`### ${g} ·`));
  if (i < 0) { console.log(`  ${g}  ✗ 找不到標題`); bad++; continue; }
  const title = L[i];
  const level = (title.match(/——\s*(.+?)（/) ?? [, '(無)'])[1];
  // 找這一條的正文範圍（到下一個 ### G 為止）
  let end = L.length;
  for (let k = i + 1; k < L.length; k++) if (/^### G\d+ ·/.test(L[k])) { end = k; break; }
  const body = L.slice(i, end).join('\n');
  const decided = /\*\*已決（2026-09-12）\*\*/.test(body);
  const supp = /補充：/.test(body);
  const ok = level === '已決待實作' && decided && supp;
  if (!ok) bad++;
  console.log(`  ${g}   ${(level === '已決待實作' ? '已決待實作 ✓' : level + ' ✗').padEnd(14)} ${(decided ? '✓' : '✗').padEnd(8)} ${(supp ? '✓ 在正文裡' : '✗ 不在').padEnd(12)} ${title.slice(0, 34)}…`);
}

const entries = L.filter((l) => /^### G\d+ ·/.test(l)).length;
const lv = {};
for (const l of L) {
  if (!/^### G\d+ ·/.test(l)) continue;
  const m = l.match(/——\s*(.+?)（/) ?? [, '(無)'];
  lv[m[1]] = (lv[m[1]] ?? 0) + 1;
}
console.log(`\n  條目 ${entries}（應 109）`);
for (const k of Object.keys(lv).sort((a, b) => lv[b] - lv[a])) console.log(`    ${String(lv[k]).padStart(3)}  ${k}`);
console.log(`\n  ${bad === 0 ? '✓ 五條全部：級別已改、已決那行在、補充在' : `✗ ${bad} 條沒齊`}`);
