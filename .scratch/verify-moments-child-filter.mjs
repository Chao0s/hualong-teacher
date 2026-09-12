// 决定性比对：GET /moments?child_id=X 到底有没有按幼儿筛。
// 库里的真值是 db_moment_upload（哪个幼儿出现在哪条在园时光）。回包里若出现
// 不在该幼儿嵌套集合里的 moment —— 那就是参数被忽略，不是「恰好相同」。
import { execSync } from 'node:child_process';

const API = 'http://127.0.0.1:3860/api/v1';
const sql = (q) => execSync(`docker exec hl-pg psql -U postgres -d hualong_test -tAc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

const token = await (async () => {
  const r = await fetch(`${API}/dev/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surface: 'teacher', subject_id: 1 }) });
  return (await r.json()).token;
})();

const truth = (c) => new Set(sql(`select string_agg(moment_id::text, ',') from db_moment_upload where child_id=${c}`).split(',').filter(Boolean).map(Number));

for (const c of [4, 1, 6]) {
  const want = truth(c);
  const j = await (await fetch(`${API}/moments?child_id=${c}&limit=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const got = (j.items ?? []).map((m) => m.moment_id);
  const inside = got.filter((id) => want.has(id));
  const outside = got.filter((id) => !want.has(id));
  console.log(`幼儿 ${c}：库里嵌套 ${want.size} 条 | 回包 ${got.length} 条`);
  console.log(`   在嵌套集合里: ${inside.length}`);
  console.log(`   不在（说明没按幼儿筛）: ${outside.length}${outside.length ? ' → ' + outside.slice(0, 8).join(', ') : ''}`);
}

// 三条幼儿的回包是否有差异 —— 全一样就说明参数没起作用
const sets = {};
for (const c of [1, 2, 3, 4]) {
  const j = await (await fetch(`${API}/moments?child_id=${c}&limit=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
  sets[c] = (j.items ?? []).map((m) => m.moment_id).join(',');
}
const distinct = new Set(Object.values(sets));
console.log(`\n四个幼儿的回包有几种: ${distinct.size}${distinct.size === 1 ? ' —— 完全相同，参数没起作用' : ' —— 有差异，参数起作用'}`);
