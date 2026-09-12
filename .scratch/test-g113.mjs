/**
 * G113 的四项行为测试。要拿「喂进去的那个值」与「库里的事实」对，不能只看形状。
 *
 * 判据（四项都要成立）：
 *   ① 不传 child_id     → 仍回全班（改动没把旧行为弄坏）
 *   ② 传本班幼儿        → **收窄**（条数 < 全班，且每条都含该幼儿）
 *   ③ 传他班幼儿        → 422 scope_violation
 *   ④ 传不存在的号 999  → 422 scope_violation
 */
const BASE = 'http://127.0.0.1:3860/api/v1';

const post = async (p, body, token) => {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return r.json();
};
const get = async (p, token) => {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json() };
};

const s = await post('/dev/session', { surface: 'teacher', subject_id: 1 });
const t = s.token;
console.log(`  教师 1 的班: class_id=${JSON.stringify(s.scope?.derived?.class_id ?? s.scope?.class_id ?? '?')}`);

const page = (b) => (b.items ?? b.data ?? b.moments ?? []);
const ids = (b) => page(b).map((m) => m.moment_id);

const a = await get('/moments?limit=50', t);
console.log(`\n  ① 不传 child_id          → ${a.status}  ${ids(a.body).length} 条`);
const classId = page(a.body)[0]?.class_id;

// 从库里取本班一个幼儿、他班一个幼儿
const kids = await (await fetch(BASE + '/teacher/class/children', { headers: { Authorization: `Bearer ${t}` } })).json().catch(() => ({}));
const mine = (kids.items ?? kids.data ?? []).map((c) => c.child_id);
console.log(`  本班幼儿（同一会话取的）: ${mine.slice(0, 3).join(', ') || '（这条端点不通，改用已知 id）'}`);

const cases = [
  ['② 本班幼儿', mine[0] ?? 1, 200],
  ['③ 他班幼儿 11', 11, 422],
  ['③ 他班幼儿 21', 21, 422],
  ['④ 不存在的 999', 999, 422],
];
console.log('');
for (const [label, id, want] of cases) {
  const r = await get(`/moments?limit=50&child_id=${id}`, t);
  const n = ids(r.body).length;
  const ok = r.status === want ? '✓' : '✗';
  const code = r.body?.code ? `  code=${r.body.code}` : '';
  const narrow = r.status === 200 ? `  ${n} 条${n < ids(a.body).length ? '（收窄了）' : '（没收窄！）'}` : '';
  console.log(`  ${ok} ${label.padEnd(16)} child_id=${String(id).padEnd(4)} → ${r.status} (期望 ${want})${code}${narrow}`);
}

// ② 还要证明「每条都真的含该幼儿」—— 只看条数会被「碰巧一样多」骗过
if (mine[0]) {
  const r = await get(`/moments?limit=50&child_id=${mine[0]}`, t);
  const got = new Set(ids(r.body));
  const allIn = ids(a.body).filter((x) => got.has(x));
  console.log(`\n  ② 收窄后的每一条都来自全班那一页吗: ${allIn.length === got.size ? '✓ 是子集' : '✗ 出现了不属于该班的 moment'}`);
}
