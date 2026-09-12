// 评价进度自动更新联动：真做一次发布，再看汇总变没变。
// 两个来源分开读 —— (a) db_growth_record 的汇总列，(b) 进度端点的实时值。
// 用 fetch，不用 curl：shell 引号会把 JSON 吃掉（已踩）。
import { execSync } from 'node:child_process';

const API = 'http://127.0.0.1:3860/api/v1';
const sql = (q) => execSync(`docker exec hl-pg psql -U postgres -d hualong_test -tAc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

const signIn = async () => {
  const r = await fetch(`${API}/dev/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surface: 'teacher', subject_id: 1 }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('签票失败: ' + JSON.stringify(j));
  return j.token;
};

const summary = (childId) =>
  sql(`select 'teacher_month='||teacher_month_complete_count||' required='||required_month_count||' term='||teacher_term_status||' record='||record_status from db_growth_record where child_id=${childId} and term_id='2025-2026-2'`);

const live = async (t, childId) => {
  const r = await fetch(`${API}/teacher-evaluations/progress`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json();
  if (!j.items) return j;
  return j.items.find((i) => i.child_id === childId);
};

const monthRow = (id) => sql(`select child_id||'|'||eval_month||'|'||month_eval_status from db_month_eval where month_eval_id=${id}`);

const token = await signIn();
const CHILD = 3;
const ME = 21; // 幼儿 3 · 2026-04 · e1

console.log('=== 发布前 ===');
console.log('  db_month_eval 21      :', monthRow(ME));
console.log('  db_growth_record 幼儿3:', summary(CHILD));
console.log('  进度端点 幼儿3        :', JSON.stringify(await live(token, CHILD)));

console.log('\n=== 发布（POST /home-school/month-evals/21/publication）===');
const res = await fetch(`${API}/home-school/month-evals/21/publication`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `probe-linkage-${Date.now()}` },
  body: JSON.stringify({ confirm: true }),
});
console.log('  HTTP', res.status, (await res.text()).slice(0, 200));

console.log('\n=== 发布后 ===');
console.log('  db_month_eval 21      :', monthRow(ME));
console.log('  db_growth_record 幼儿3:', summary(CHILD));
console.log('  进度端点 幼儿3        :', JSON.stringify(await live(token, CHILD)));
