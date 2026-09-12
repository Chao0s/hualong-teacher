// 学期评价那条路：真提交一次，再看两个来源。
import { execSync } from 'node:child_process';

const API = 'http://127.0.0.1:3860/api/v1';
const sql = (q) => execSync(`docker exec hl-pg psql -U postgres -d hualong_test -tAc ${JSON.stringify(q)}`, { encoding: 'utf8' }).trim();

const signIn = async () => {
  const r = await fetch(`${API}/dev/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ surface: 'teacher', subject_id: 1 }) });
  return (await r.json()).token;
};
const summary = (c) => sql(`select 'teacher_term='||teacher_term_status||' record='||record_status from db_growth_record where child_id=${c} and term_id='2025-2026-2'`);
const live = async (t, c) => (await (await fetch(`${API}/teacher-evaluations/progress`, { headers: { Authorization: `Bearer ${t}` } })).json()).items.find((i) => i.child_id === c);
const termRows = (c) => sql(`select count(*)::text||' 行: '||coalesce(string_agg(term_eval_id||'='||term_eval_status,','),'-') from db_term_eval where child_id=${c}`);

const token = await signIn();
const CHILD = 3;

console.log('=== 基线 ===');
console.log('  db_term_eval 幼儿3     :', termRows(CHILD));
console.log('  db_growth_record 幼儿3 :', summary(CHILD));
console.log('  进度端点 term_eval_status:', (await live(token, CHILD)).term_eval_status);

console.log('\n=== PUT /children/3/term-evaluation ===');
const res = await fetch(`${API}/children/${CHILD}/term-evaluation`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `probe-termsubmit-${Date.now()}` },
  body: JSON.stringify({ eval_text: '本学期的观察记录：幼儿在语言表达与社会交往两方面进步明显，能主动与同伴合作完成搭建任务。' }),
});
console.log('  HTTP', res.status, (await res.text()).slice(0, 260));

console.log('\n=== 提交后 ===');
console.log('  db_term_eval 幼儿3     :', termRows(CHILD));
console.log('  db_growth_record 幼儿3 :', summary(CHILD));
console.log('  进度端点 term_eval_status:', (await live(token, CHILD)).term_eval_status);
