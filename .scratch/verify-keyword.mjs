/**
 * G110 的关键词——**与库逐条对集合**，不是看条数。
 *
 * 上一版断言「收窄」时写的是「全部 11 → 命中 11」，那既可能是「全部命中」
 * 也可能是「过滤没生效」——两种情况的数字一模一样。§7.6 那条教训。
 *
 * 这里对每个关键词：
 *   ① 在库里用同一个 scope 算出**期望的 id 集合**（名称 or 说明 ILIKE）
 *   ② 打端点拿**实际 id 集合**
 *   ③ 断言两个集合**相等**（不是数量相等）
 */
import { execSync } from 'node:child_process';

const PORT = process.argv[2] ?? '3862';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

const psql = (sql) =>
  execSync(`docker exec hl-pg psql -U postgres -d hualong_test -tAc ${JSON.stringify(sql.replace(/\n\s*/g, ' '))}`,
    { encoding: 'utf8' }).trim().split('\n').map((s) => s.trim()).filter(Boolean);

// 教师 1 的 school_id / teacher_id —— 端点的 scope 就是这两个
const [schoolId, teacherId] = psql('select school_id, teacher_id from db_teacher where teacher_id = 1')[0].split('|').map(Number);
console.log(`  教师 1: school_id=${schoolId} teacher_id=${teacherId}\n`);

const token = (await (await fetch(`${BASE}/dev/session`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ surface: 'teacher', subject_id: 1 }),
})).json()).token;

const ids = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const b = await r.json();
  return { status: r.status, ids: (b.items ?? []).map((x) => x.resource_id ?? x.case_id) };
};

const same = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

const rows = [];
const check = (label, kw, kind) => {
  if (kind === 'resource') {
    const want = psql(`select resource_id from db_resource r where r.school_id = ${schoolId}
       and (r.resource_status <> 's1' or r.created_by = ${teacherId})
       and (r.resource_name ilike '%${kw}%' or r.resource_explain ilike '%${kw}%') order by resource_id`).map(Number);
    return { want, path: `/library/resources?limit=50&keyword=${encodeURIComponent(kw)}` };
  }
  const want = psql(`select case_id from db_case cs where cs.school_id = ${schoolId}
     and (cs.case_status <> 's1' or cs.created_by = ${teacherId})
     and (cs.case_name ilike '%${kw}%' or cs.case_intro ilike '%${kw}%') order by case_id`).map(Number);
  return { want, path: `/library/cases?limit=50&keyword=${encodeURIComponent(kw)}` };
};

for (const [kind, kws] of [['resource', ['龙舟', '醒狮', '水乡', '布', '不存在的词xyz']], ['case', ['龙舟', '醒狮', '水乡', '布', '不存在的词xyz']]]) {
  console.log(`  ── ${kind === 'resource' ? '/library/resources' : '/library/cases'} ──`);
  for (const kw of kws) {
    const { want, path } = check(kind, kw, kind);
    const got = await ids(path);
    const ok = same(want, got.ids);
    rows.push([ok, kw, want, got.ids]);
    console.log(`   ${ok ? '✓' : '✗'} keyword=${JSON.stringify(kw).padEnd(18)} 库 ${JSON.stringify(want).padEnd(22)} 端点 ${JSON.stringify(got.ids)}`);
  }
}

const bad = rows.filter((r) => !r[0]).length;
console.log(`\n  ${rows.length - bad} 项通过，${bad} 项失败。（判据：集合相等，不只是条数相等）`);
