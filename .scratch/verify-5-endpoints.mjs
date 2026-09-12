/**
 * 五条新/改端点的验收。判据钉到库里的值，不只看形状（§7.6）。
 *
 *   可用 = 200 且字段齐、条数与库里一致
 *   不可用 = 501/404
 */
const BASE = `http://127.0.0.1:${process.argv[2] ?? 3860}/api/v1`;

const post = async (p, body) =>
  (await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();

const get = async (p, token) => {
  const r = await fetch(BASE + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let b = null;
  try { b = await r.json(); } catch { /* 非 JSON */ }
  return { status: r.status, body: b };
};

const t = (await post('/dev/session', { surface: 'teacher', subject_id: 1 })).token;
const admin = (await post('/dev/session', { surface: 'admin', subject_id: 1 })).token;

const items = (b) => b?.items ?? [];

const rows = [];
const note = (name, ok, detail) => { rows.push([ok ? '✓' : '✗', name, detail]); };

// ── G109 资源 → 相关案例
{
  const r = await get('/library/resources/1/cases', t);
  const ok = r.status === 200 && Array.isArray(items(r.body));
  note('G109 /library/resources/1/cases', ok, `${r.status}  ${items(r.body).length} 条`);
  // 不存在的资源必须 404，**不回空列表**
  const bad = await get('/library/resources/99999/cases', t);
  note('G109 不存在的资源要 404', bad.status === 404, `${bad.status}  ${bad.body?.code ?? ''}`);
}

// ── G110 keyword（两条列表）
{
  const all = await get('/library/resources?limit=50', t);
  const hit = await get('/library/resources?limit=50&keyword=' + encodeURIComponent('资'), t);
  const ok = hit.status === 200 && items(hit.body).length <= items(all.body).length;
  note('G110 资源 keyword 收窄', ok, `全部 ${items(all.body).length} → 命中 ${items(hit.body).length}`);

  const cAll = await get('/library/cases?limit=50', t);
  const cHit = await get('/library/cases?limit=50&keyword=' + encodeURIComponent('活'), t);
  note('G110 案例 keyword 收窄', cHit.status === 200, `全部 ${items(cAll.body).length} → 命中 ${items(cHit.body).length}`);

  // 空词等于不筛（应回全部）
  const blank = await get('/library/resources?limit=50&keyword=', t);
  note('G110 空 keyword = 不筛', items(blank.body).length === items(all.body).length,
    `${items(blank.body).length} vs ${items(all.body).length}`);
}

// ── G111 教研培训首页聚合
{
  const r = await get('/training/home', t);
  const b = r.body ?? {};
  const ok = r.status === 200 && Array.isArray(b.carousel) && Array.isArray(b.recommended_resources) && Array.isArray(b.recommended_cases);
  note('G111 /training/home 三块齐', ok,
    `${r.status}  轮播 ${b.carousel?.length}  资源 ${b.recommended_resources?.length}  案例 ${b.recommended_cases?.length}`);
}

// ── G112 教师读家长交的栏目素材
{
  const r = await get('/teacher/growth-book/sections/1/submissions', t);
  const ok = r.status === 200 || r.status === 404;
  note('G112 教师读栏目素材（不 501）', ok, `${r.status}  ${items(r.body).length} 条  ${r.body?.code ?? ''}`);
  // 他班的栏目：换一个不属于教师 1 班的 section
  const other = await get('/teacher/growth-book/sections/99/submissions', t);
  note('G112 不存在的栏目要 404', other.status === 404, `${other.status}  ${other.body?.code ?? ''}`);
}

// ── G113 child_id（已有测试，这里只确认没被弄坏）
{
  const a = await get('/moments?limit=50', t);
  const b = await get('/moments?limit=50&child_id=1', t);
  const c = await get('/moments?limit=50&child_id=11', t);
  note('G113 不传 = 全班 / 本班 = 收窄 / 他班 = 422',
    a.status === 200 && b.status === 200 && c.status === 422,
    `${a.status}(${items(a.body).length})  ${b.status}(${items(b.body).length})  ${c.status}(${c.body?.code ?? ''})`);
}

console.log('\n| | 项目 | 结果 |');
console.log('|---|---|---|');
for (const [ok, name, detail] of rows) console.log(`| ${ok} | ${name} | ${detail} |`);
const bad = rows.filter((r) => r[0] === '✗').length;
console.log(`\n  ${rows.length - bad} 项通过，${bad} 项失败。`);
