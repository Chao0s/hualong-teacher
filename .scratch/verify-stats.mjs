// 逐表行数对 STATS.md（CLAUDE.md §6：会改数据库的探针必须自己收拾并核对行数）
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = 'G:/My Drive/Workplace/China KG Platform/hualong-backend';
const sql = (q) => execSync(`docker exec hl-pg psql -U postgres -d hualong_test -tAc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

const stats = readFileSync(`${ROOT}/db/testdata/STATS.md`, 'utf8');
const want = new Map();
for (const m of stats.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|/gm)) want.set(m[1], Number(m[2]));

const tables = sql("select tablename from pg_tables where schemaname='public' order by tablename").split('\n').filter(Boolean);
let bad = 0, checked = 0, missing = 0;
for (const t of tables) {
  const n = Number(sql(`select count(*) from ${t}`));
  if (!want.has(t)) { missing++; continue; }
  checked++;
  if (want.get(t) !== n) { bad++; console.log(`  ✗ ${t}: STATS 说 ${want.get(t)}，库里 ${n}`); }
}
console.log(`\n  STATS.md 里有 ${want.size} 张表；实际比对 ${checked} 张`);
console.log(`  行数不符: ${bad}`);
console.log(`  STATS.md 未列出的表: ${missing}`);
if (bad === 0) console.log('  ✓ 逐表行数与 STATS.md 逐张相符');
