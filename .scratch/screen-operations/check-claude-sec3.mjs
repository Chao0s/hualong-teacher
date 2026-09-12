// CLAUDE.md §3 的「已接」表 vs 扫描器实测的已接集合，差在哪。
import { readFileSync } from 'node:fs';
const REPO = 'G:/My Drive/Workplace/China KG Platform/hualong-teacher';
const doc = readFileSync(`${REPO}/CLAUDE.md`, 'utf8').replace(/\r\n/g, '\n');

// §3 那张表：| `dir` | 屏幕上叫 | 怎么走到 |
const sec3 = doc.slice(doc.indexOf('## 3. 现状'), doc.indexOf('## 4. service 层的写法'));
const inTable = new Set();
for (const m of sec3.matchAll(/^\|\s*`([a-z0-9-]+)`(?:\s*\/\s*`[a-z0-9-]+`)?\s*\|/gm)) inTable.add(m[1]);

// 扫描器报告的已接集合
const json = JSON.parse(readFileSync(`${REPO}/docs/audit/wiring-2026-09-11.json`, 'utf8'));
const wired = json.pages.filter((p) => p.wired).map((p) => p.name).sort();
const notWired = json.pages.filter((p) => !p.wired).map((p) => p.name).sort();

console.log(`§3 表里提到 ${inTable.size} 个目录名`);
console.log(`扫描器：共 ${json.pages.length} 页，已接 ${wired.length}，未接 ${notWired.length}\n`);

const missing = wired.filter((n) => !inTable.has(n));
console.log(`=== 已接、但 §3 表里没有的（${missing.length} 个）===`);
for (const n of missing) {
  const t = json.pages.find((p) => p.name === n).title;
  console.log(`  ${n.padEnd(34)} ${t}`);
}
const stale = [...inTable].filter((n) => !wired.includes(n) && json.pages.some((p) => p.name === n));
console.log(`\n=== §3 表里有、但扫描器说未接的（${stale.length} 个）===`);
for (const n of stale) console.log(`  ${n}`);
console.log(`\n=== 未接的 ${notWired.length} 个（文档说 9 个）===`);
console.log('  ' + notWired.join(', '));
