// 挑测试账号：admin×1 / teacher×1 / parent×3。字段名照 dataset.json 的真实形状。
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('G:/My Drive/Workplace/China KG Platform/hualong-backend/db/testdata/dataset.json', 'utf8'));
const byChild = new Map(d.children.map((c) => [c.child_id, c]));

const t = d.teachers.find((x) => x.teacher_id === 1);
const inClass = new Set(d.children.filter((c) => c.class_id === t.class_id && c.enrollment_status === 'e1').map((c) => c.child_id));

const cand = d.parents.map((p) => {
  const kids = (p.visible_child_ids || []).map((i) => byChild.get(i)).filter(Boolean);
  const inT = kids.filter((c) => inClass.has(c.child_id));
  return { p, kids, inT };
});

const pick = [];
const seen = new Set();
// 去重按 parent_id，不按对象身份 —— 第一版 `pick.includes(x)` 比的是对象，
// 而 `take` 展开了新对象，于是同一个家长被两条判据各选一次（实测家长 1 被选两遍）。
const take = (x, why) => {
  if (!x || seen.has(x.p.parent_id)) return;
  seen.add(x.p.parent_id);
  pick.push({ ...x, why });
};

// ① 幼儿在教师 1 的班上 —— 可与教师端对着核同一份数据
const sameClass = cand.filter((c) => c.inT.length > 0).sort((a, b) => b.inT.length - a.inT.length);
take(sameClass[0], sameClass[0] ? `有 ${sameClass[0].inT.length} 名幼儿在教师 1 的班上 —— 可与教师端核同一份数据` : '');
// ② 可见幼儿最多 —— 验「切换孩子」与跨班可见性
const most = cand.filter((c) => !seen.has(c.p.parent_id)).sort((a, b) => b.kids.length - a.kids.length);
take(most[0], most[0] ? `可见 ${most[0].kids.length} 名幼儿（含别班的）—— 验「切换孩子」与跨班可见性` : '');
// ③ 只有 1 名幼儿 —— 最简单的一条路
const one = cand.filter((c) => c.kids.length === 1 && !seen.has(c.p.parent_id));
take(one[0], one[0] ? '只有 1 名幼儿 —— 最简单的一条路，出问题最好定位' : '');

console.log('=== 教师（1 个）===');
console.log(`  teacher_id ${t.teacher_id}  ${t.teacher_name}  班 class_id=${t.class_id}  ${t.assignment_role}  ${t.teacher_status}`);
console.log(`  该班在园幼儿 ${inClass.size} 名`);

console.log('\n=== 家长（3 个）===');
for (const x of pick) {
  console.log(`  parent_id ${x.p.parent_id}  ${x.p.parent_name}  可见幼儿 ${x.kids.map((c) => `${c.child_id}:${c.child_name}(班${c.class_id})`).join(', ')}`);
  console.log(`     挑它的理由：${x.why}`);
}

console.log('\n=== 管理端（1 个）===');
const a = d.admins[0];
console.log(`  admin_id ${a.admin_id}  ${a.admin_name}  role ${a.role}`);
console.log(`  （数据集共 ${d.admins.length} 个管理员）`);

console.log('\n=== 名册全貌（供 env 文件写注释）===');
console.log(`  管理 ${d.admins.length} · 教师 ${d.teachers.length} · 家长 ${d.parents.length} · 幼儿 ${d.children.length}`);
console.log(`  教师在职 ${d.teachers.filter((x) => x.teacher_status === 's1').length}，离职 ${d.teachers.filter((x) => x.teacher_status !== 's1').length}`);
console.log(`  数据基准日 dataset_today = ${d.dataset_today}`);
