/**
 * 在园时光（`/moments` 5 条端点，契约 v0.7）的探针。**会改数据库，跑完自己收拾。**
 *
 * v0.7 把这一族的形状换掉了：不存草稿、一次提交即发布、发布后不可改只可删。
 * 所以这里测的不再是「s1→s3→s5→s3 四向迁移」，而是：
 *
 *   发布一步到位（NONE→s3，published_at 由服务端设）
 *   完整性在发布时验（缺标题／缺幼儿／正文与照片都空，各回一个指名道姓的 422）
 *   删除是物理删除，且**连带解除入册通道与照片引用**——即便编册已锁定
 *   删不动的两种情况：不是原作者、管理员已下架
 *
 * 删除这类不可逆动作只测「状态码对不对」是不够的：一个回 409 却真的删了行的实作，
 * 只看状态码看不出来。所以每条被拒之后都回库里核对行数没变。
 *
 *   node tools/probe-moments.mjs
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = 'G:/My Drive/Personal Materials/App Dev/Hualong/hualong-backend/db/testdata';
const DB_URL = 'postgres://postgres:postgres@localhost:5432/hualong_test';

const require_ = createRequire(import.meta.url);
const co = require_(resolve(MP, 'services', 'co-education.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);
const made = [];

// 数据集基线（STATS.md）。教师 1 是 1 班主班，班上 10 名在园幼儿。
const BASE = { moment: 126, upload: 691, fileRef: 745, material: 138 };
const CLASS_SIZE = 10;
// 数据集的「今天」是 2026-04-25，当前学期 2025-2026-2（02-23 ~ 07-10）。
const TODAY = '2026-04-25';

async function counts() {
  const r = await db.query(`SELECT
    (SELECT count(*)::int FROM db_moment) AS moment,
    (SELECT count(*)::int FROM db_moment_upload) AS upload,
    (SELECT count(*)::int FROM db_file_ref) AS "fileRef",
    (SELECT count(*)::int FROM db_growth_material) AS material`);
  return r.rows[0];
}

async function exists(id) {
  const r = await db.query('SELECT count(*)::int AS n FROM db_moment WHERE moment_id=$1', [id]);
  return r.rows[0].n === 1;
}

/** 断言某个删除被拒，**且那一行还在**。 */
async function refusesDelete(label, id, token, expectRule) {
  const before = await exists(id);
  let rule = '(没被拒)';
  try {
    await token();
  } catch (err) {
    rule = (err.details && err.details.rule) || err.code;
  }
  check(`${label} 被拒（${expectRule}）`, rule === expectRule, `实际：${rule}`);
  check(`${label} 之后那一行还在`, before && (await exists(id)), '行被删掉了');
}

async function main() {
  await db.connect();
  const base = await counts();
  console.log(`基线：moment=${base.moment} upload=${base.upload} file_ref=${base.fileRef} material=${base.material}`);
  check('基线与 STATS.md 一致',
    base.moment === BASE.moment && base.upload === BASE.upload
    && base.fileRef === BASE.fileRef && base.material === BASE.material,
    JSON.stringify(base));

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 读 ───────────────────────────────────────────────────────────────── */
  const page = await co.listMoments({ limit: 100 });
  check('列表非空', page.items.length > 0, `拿到 ${page.items.length} 条`);
  has(page.items[0], ['id', 'title', 'date', 'dateLabel', 'weekKey', 'status', 'statusLabel', 'can'], '列表行');
  check('状态只出现 s1/s3/s5（s1 是拍板前的旧数据，仍要渲染）',
    page.items.every((m) => ['s1', 's3', 's5'].includes(m.status)),
    `实际：${[...new Set(page.items.map((m) => m.status))].join(',')}`);
  check('日期是 M月D日，不是 ISO 串',
    page.items.every((m) => /^\d{1,2}月\d{1,2}日$/.test(m.dateLabel)),
    `实际：${page.items.slice(0, 3).map((m) => m.dateLabel).join(',')}`);

  const foreign = await db.query(
    'SELECT count(*)::int AS n FROM db_moment WHERE moment_id = ANY($1) AND class_id <> 1',
    [page.items.map((m) => m.id)]
  );
  check('列表里没有别班的时光（范围收窄生效）', foreign.rows[0].n === 0,
    `混进了 ${foreign.rows[0].n} 条`);

  // s5 是管理端下架的结果，教师不能删 —— 按钮据此不渲染
  const s5 = page.items.filter((m) => m.status === 's5');
  check('管理端下架的（s5）不给删按钮', s5.every((m) => m.can.remove === false),
    `实际：${JSON.stringify(s5.map((m) => [m.id, m.can.remove]))}`);

  /* ── 图片：列表回 file_id，地址逐张换，换来的要真的是图 ────────────────── */
  const withPhotos = page.items.filter((m) => m.fileIds.length > 0);
  check('列表回 file_id（契约的 Moment 含这一列）',
    page.items.every((m) => Array.isArray(m.fileIds)),
    '有的行没有 fileIds —— 列表端点又不回这一列了');
  check('确实有带图的时光', withPhotos.length > 0,
    '一条带图的都没有，后面的图片断言测不到东西');

  const dbRefs = await db.query(
    `SELECT owner_id, count(*)::int AS n FROM db_file_ref
      WHERE owner_object='db_moment' AND usage_key='image' AND owner_id = ANY($1::int[])
      GROUP BY owner_id`,
    [page.items.map((m) => m.id)]
  );
  const expect = new Map(dbRefs.rows.map((r) => [r.owner_id, r.n]));
  check('列表的 file_id 张数与库里的引用数逐条对得上',
    page.items.every((m) => m.fileIds.length === (expect.get(m.id) ?? 0)),
    JSON.stringify(page.items.map((m) => [m.id, m.fileIds.length, expect.get(m.id) ?? 0])));

  const someFile = withPhotos[0].fileIds[0];
  const url = await co.photoUrl(someFile);
  check('取图地址拿得到', Boolean(url), '回的是空串');
  check('取图地址不含任何直连对象存储的痕迹（G16／F21）',
    !/example-cos\.invalid/.test(url), `实际 ${url}`);

  // 地址后面必须真的是一张图 —— 只验「有地址」等于没验，之前 example-cos.invalid
  // 也是有地址的。
  const got = await fetch(url).then(
    async (r) => ({ status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }),
    () => null,
  );
  check('地址取得回 200', got && got.status === 200, got ? `HTTP ${got.status}` : '请求失败');
  check('回的是 image/*', got && /^image\//.test(got.type || ''), got ? got.type : '(无)');
  check('字节是一张合法 PNG',
    got && got.buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a',
    got ? got.buf.slice(0, 8).toString('hex') : '(无)');

  if (withPhotos[0].fileIds[1]) {
    const second = await co.photoUrl(withPhotos[0].fileIds[1]);
    check('不同 file_id 给出不同地址', second !== url, `两张都是 ${url}`);
  }

  // 没有图片的那些必须是空数组，不是 null —— 页面直接 .length，不该再判类型
  const noPhoto = page.items.filter((m) => m.fileIds.length === 0);
  check('没有图片的时光回空数组而不是 null',
    noPhoto.every((m) => Array.isArray(m.fileIds)), '出现了 null');

  /* ── 周覆盖 ───────────────────────────────────────────────────────────── */
  const cov = await co.weeklyCoverage({ weekKey: '2026-W17' });
  check(`周覆盖回全班 ${CLASS_SIZE} 人`, cov.length === CLASS_SIZE, `实际 ${cov.length} 人`);
  has(cov[0], ['childId', 'name', 'count', 'done'], '周覆盖行');
  check('0 次的幼儿也在结果里', cov.some((r) => r.count === 0),
    'LEFT JOIN 又被 WHERE 过滤成 INNER 了');
  check('完成线是 >=2（0 与 1 都算未完成）',
    cov.every((r) => r.done === (r.count >= 2)), JSON.stringify(cov.map((r) => [r.count, r.done])));

  const empty = await co.weeklyCoverage({ weekKey: '2026-W15' });
  check('全班无记录的那一周仍回全班名册（不是空集合）',
    empty.length === CLASS_SIZE && empty.every((r) => r.count === 0), `实际 ${empty.length} 人`);

  const roster = await co.classRoster();
  check(`名册回全班 ${CLASS_SIZE} 人且都有姓名`,
    roster.length === CLASS_SIZE && roster.every((r) => r.name), `实际 ${roster.length} 人`);

  /* ── 发布前预检（客户端侧，与服务端规则必须一致） ──────────────────────── */
  check('缺标题时说缺标题',
    co.whyCannotPublish({ title: '', childIds: [1], content: 'x' }) === '请填写活动标题');
  check('没选幼儿时说没选幼儿',
    co.whyCannotPublish({ title: 'x', childIds: [], content: 'x' }) === '请至少选择一名幼儿');
  check('评语与照片都空时拦下',
    co.whyCannotPublish({ title: 'x', childIds: [1], content: '', fileIds: [] }) !== '');
  check('照片超过 9 张时拦下',
    co.whyCannotPublish({ title: 'x', childIds: [1], content: 'x', fileIds: Array(10).fill(0) }) !== '');
  check('齐全时放行',
    co.whyCannotPublish({ title: 'x', childIds: [1], content: 'x', fileIds: [] }) === '');

  /* ── 服务端的完整性校验：三种缺项各回一个指名道姓的 422 ────────────────── */
  const bad = [
    ['缺标题', { title: '', content: 'x', date: TODAY, childIds: [roster[0].childId] }, 'moment_title'],
    ['缺幼儿', { title: 'x', content: 'x', date: TODAY, childIds: [] }, 'child_id'],
    ['正文与照片都空', { title: 'x', content: '', date: TODAY, childIds: [roster[0].childId], fileIds: [] }, 'moment_content'],
  ];
  for (const [label, body, field] of bad) {
    let got = '(没被拒)';
    try {
      const r = await co.publish(body);
      if (r && r.moment_id) made.push(r.moment_id);
    } catch (err) {
      got = (err.details && err.details.field) || err.code;
    }
    check(`服务端拒绝「${label}」并指出是 ${field}`, got === field, `实际：${got}`);
  }

  /* ── 发布：一步到位 ───────────────────────────────────────────────────── */
  const created = await co.publish({
    title: '探针活动（可删）',
    content: '这是探针建的行，脚本结束时会删掉。',
    date: TODAY,
    childIds: [roster[0].childId, roster[1].childId],
    fileIds: [],
  });
  check('POST /moments 回了 moment_id', Boolean(created && created.moment_id), JSON.stringify(created));
  const id = created.moment_id;
  made.push(id);

  const row = await db.query(
    'SELECT publish_status, published_at, school_id, class_id, teacher_id, week_key FROM db_moment WHERE moment_id=$1',
    [id]
  );
  const r0 = row.rows[0];
  check('一次提交即 s3，没有草稿态', r0.publish_status === 's3', `实际 ${r0.publish_status}`);
  check('published_at 由服务端设定', Boolean(r0.published_at), 'published_at 是空的');
  check('school_id/class_id/teacher_id 全由服务端派生',
    r0.school_id === 1 && r0.class_id === 1 && r0.teacher_id === 1,
    JSON.stringify([r0.school_id, r0.class_id, r0.teacher_id]));
  check('week_key 由服务端从 moment_date 算出', r0.week_key === '2026-W17', `实际 ${r0.week_key}`);

  const detail = await co.getMoment(id);
  check('已发布的 can 只允许删除', detail.can.remove === true, JSON.stringify(detail.can));
  check('child_id 读得回来（整份写入生效）',
    JSON.stringify(detail.childIds) === JSON.stringify([roster[0].childId, roster[1].childId]),
    JSON.stringify(detail.childIds));

  const uploads = await db.query('SELECT count(*)::int AS n FROM db_moment_upload WHERE moment_id=$1', [id]);
  check('db_moment_upload 建了 2 行', uploads.rows[0].n === 2, `实际 ${uploads.rows[0].n} 行`);

  /* ── 覆盖聚合随发布上升 ───────────────────────────────────────────────── */
  const covAfter = await co.weeklyCoverage({ weekKey: r0.week_key });
  const bumped = covAfter.filter((x) => [roster[0].childId, roster[1].childId].includes(x.childId));
  const baseline = cov.filter((x) => [roster[0].childId, roster[1].childId].includes(x.childId));
  check('发布后被点名的幼儿周覆盖 +1',
    bumped.every((x, i) => x.count === baseline[i].count + 1),
    `发布前 ${JSON.stringify(baseline.map((x) => x.count))}，发布后 ${JSON.stringify(bumped.map((x) => x.count))}`);

  /* ── child_id 是 scoped：别班幼儿必须被拒 ──────────────────────────────── */
  const other = await db.query(
    'SELECT child_id FROM db_child WHERE class_id <> 1 AND enrollment_status = $1 LIMIT 1', ['e1']
  );
  if (other.rows[0]) {
    let rule = '(没被拒)';
    try {
      const r = await co.publish({
        title: '范围探针（可删）', content: 'x', date: TODAY,
        childIds: [roster[0].childId, other.rows[0].child_id], fileIds: [],
      });
      if (r && r.moment_id) made.push(r.moment_id);
    } catch (err) { rule = (err.details && err.details.rule) || err.code; }
    check('名单里混入别班幼儿回 scope_violation', rule === 'child_not_in_class', `实际 ${rule}`);
  }

  /* ── 删不动的两种情况 ─────────────────────────────────────────────────── */
  // 1. 不是原作者：换教师 2 的会话来删教师 1 的
  const mine = session.getToken();
  session.clear();
  const auth = require_(resolve(MP, 'utils', 'auth.js'));
  const config = require_(resolve(MP, 'config.js'));
  const realSubject = config.devSubjectId;
  config.devSubjectId = 2;
  await auth.ensureSession();
  await refusesDelete('别的教师删这一条', id, () => co.remove(id), 'author_is_caller');
  config.devSubjectId = realSubject;
  session.clear();
  await auth.ensureSession();
  check('换回原教师后会话正常', Boolean(session.getToken()) && session.getToken() !== mine);

  // 2. 管理员已下架的：数据集里有 6 条带 review_action 的
  const governed = await db.query(
    `SELECT m.moment_id FROM db_moment m
      WHERE m.class_id = 1 AND m.teacher_id = 1
        AND EXISTS (SELECT 1 FROM db_review_action ra
                     WHERE ra.moment_id = m.moment_id AND ra.decision IN ('d3','d5'))
      LIMIT 1`
  );
  if (governed.rows[0]) {
    await refusesDelete('管理员已下架的这一条', governed.rows[0].moment_id,
      () => co.remove(governed.rows[0].moment_id), 'admin_action_exists');
  } else {
    note('数据集里教师 1 名下没有带 review_action 的 moment，admin_action_exists 这一路没测到。',
      '服务端逻辑已写（EXISTS 子查询内联在前置判定里），但本轮没有可打的靶子。');
  }

  /* ── 删除：级联解除入册通道，即便编册已锁定 ────────────────────────────── */
  // 挂一条入册通道到**已锁定（e2）**的编册上，外加两条 file_ref
  const lockedComp = await db.query(
    "SELECT compilation_id FROM db_growth_book_compilation WHERE compilation_status='e2' LIMIT 1"
  );
  const gm = await db.query(
    `INSERT INTO db_growth_material (compilation_id, moment_id, source_type, title, source_date)
     VALUES ($1, $2, 'm1', '探针入册（可删）', $3) RETURNING growth_material_id`,
    [lockedComp.rows[0].compilation_id, id, TODAY]
  );
  const gmid = gm.rows[0].growth_material_id;
  await db.query(
    "INSERT INTO db_file_ref (owner_object, owner_id, file_id, usage_key) VALUES ('db_growth_material',$1,1,'image')",
    [gmid]
  );
  await db.query(
    "INSERT INTO db_file_ref (owner_object, owner_id, file_id, usage_key) VALUES ('db_moment',$1,1,'image')",
    [id]
  );
  const before = await counts();

  await co.remove(id);

  const after = await counts();
  check('删除后本体没了', !(await exists(id)));
  check('db_moment_upload 的 2 行一并删掉', after.upload === before.upload - 2,
    `${before.upload} → ${after.upload}`);
  check('入册通道一并解除（即便编册已锁定 e2）', after.material === before.material - 1,
    `${before.material} → ${after.material}`);
  check('两条 file_ref（moment 的与 growth_material 的）一并解除',
    after.fileRef === before.fileRef - 2, `${before.fileRef} → ${after.fileRef}`);
  const gone = await db.query('SELECT count(*)::int AS n FROM db_growth_material WHERE growth_material_id=$1', [gmid]);
  check('那条 growth_material 确实没了', gone.rows[0].n === 0);

  // 覆盖聚合随删除回落
  const covBack = await co.weeklyCoverage({ weekKey: r0.week_key });
  const back = covBack.filter((x) => [roster[0].childId, roster[1].childId].includes(x.childId));
  check('删除后周覆盖回落到发布前',
    back.every((x, i) => x.count === baseline[i].count),
    `发布前 ${JSON.stringify(baseline.map((x) => x.count))}，删除后 ${JSON.stringify(back.map((x) => x.count))}`);

  check('删掉的这一条读不到了（404）',
    await co.getMoment(id).then(() => false, (e) => e.code === 'not_found'));

  /* ── moment_date 夹进本学期（Q59-n1） ─────────────────────────────────── */
  const term = session.getCurrentTerm();
  check('学期内的今天原样返回',
    co.defaultMomentDate(Date.parse('2026-04-25T00:00:00+08:00')) === '2026-04-25');
  check('学期结束后的今天被夹到学期末',
    co.defaultMomentDate(Date.parse('2026-08-31T00:00:00+08:00')) === term.end_date,
    `实际 ${co.defaultMomentDate(Date.parse('2026-08-31T00:00:00+08:00'))}`);
  check('学期开始前的今天被夹到学期初',
    co.defaultMomentDate(Date.parse('2025-12-01T00:00:00+08:00')) === term.start_date);

  /* ── 服务端也在验日期（Q59-n1），不是只靠客户端夹取 ────────────────────── */
  const dateCases = [
    ['跨学期的日期', '2026-08-31', 'moment_date_in_current_term'],
    ['晚于园所今天的日期', '2026-05-20', 'moment_date_not_after_school_today'],
  ];
  for (const [label, date, rule] of dateCases) {
    let got = '(没被拒)';
    try {
      const r = await co.publish({ title: '日期探针（可删）', content: 'x', date, childIds: [roster[0].childId], fileIds: [] });
      if (r && r.moment_id) made.push(r.moment_id);
    } catch (err) { got = (err.details && err.details.rule) || err.code; }
    check(`服务端拒绝${label}（${rule}）`, got === rule, `实际 ${got}`);
  }
  // 补记本学期较早的周次是允许的 —— 别把上面两条写成「一律只能是今天」。
  const backdated = await co.publish({
    title: '补记探针（可删）', content: 'x', date: '2026-03-10',
    childIds: [roster[0].childId], fileIds: [],
  });
  made.push(backdated.moment_id);
  check('补记本学期较早的周次仍然放行', Boolean(backdated.moment_id));

  /* ── 范围与不存在 ─────────────────────────────────────────────────────── */
  check('不存在的 moment_id 回 not_found',
    await co.getMoment(999999).then(() => false, (e) => e.code === 'not_found'));
  const otherClass = await db.query('SELECT moment_id FROM db_moment WHERE class_id <> 1 LIMIT 1');
  if (otherClass.rows[0]) {
    check('别班的 moment_id 回 not_found（不泄漏存在性）',
      await co.getMoment(otherClass.rows[0].moment_id).then(() => false, (e) => e.code === 'not_found'));
  }
}

async function cleanup() {
  for (const id of made) {
    await db.query("DELETE FROM db_file_ref WHERE owner_object='db_growth_material' AND owner_id IN (SELECT growth_material_id FROM db_growth_material WHERE moment_id=$1)", [id]);
    await db.query('DELETE FROM db_growth_material WHERE moment_id=$1', [id]);
    await db.query("DELETE FROM db_file_ref WHERE owner_object='db_moment' AND owner_id=$1", [id]);
    await db.query('DELETE FROM db_moment_upload WHERE moment_id=$1', [id]);
    await db.query('DELETE FROM db_moment WHERE moment_id=$1', [id]);
  }
  await db.query("SELECT setval('db_moment_moment_id_seq', (SELECT max(moment_id) FROM db_moment))");
}

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理无论主体成败都跑：主体半途炸掉时，已经建出来的行更需要被收走。
  .then(async () => {
    try {
      await cleanup();
      const a = await counts();
      check('清理后四张表全部回到基线',
        a.moment === BASE.moment && a.upload === BASE.upload
        && a.fileRef === BASE.fileRef && a.material === BASE.material,
        JSON.stringify(a));
      console.log(`清理后：moment=${a.moment} upload=${a.upload} file_ref=${a.fileRef} material=${a.material}`);
    } catch (err) {
      check(`清理失败，数据库可能残留了行：${err.message}`, false);
    }
    await db.end().catch(() => {});
    sb.report();
  });
