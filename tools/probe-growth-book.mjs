/**
 * 成长素材与在园时光主题八条端点的探针（G68 那一族）。**会改数据库，跑完自己收拾。**
 *
 *   `GET    /teacher/growth-book/materials`                        本班本学期已入册的素材
 *   `POST   /teacher/growth-book/materials`                        把一则在园时光收进本学期编册
 *   `PATCH  /teacher/growth-book/materials/topic-assignment`       批量归入主题／撤销归类
 *   `DELETE /teacher/growth-book/materials/{growth_material_id}`   移出本学期编册
 *   `GET    /teacher/growth-book/time-topics`                      本学期主题清单
 *   `POST   /teacher/growth-book/time-topics`                      新建主题
 *   `PATCH  /teacher/growth-book/time-topics/{time_topic_id}`      重命名主题
 *   `DELETE /teacher/growth-book/time-topics/{time_topic_id}`      删除主题（＝集体撤销归类）
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 与
 * `services/growth-book.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一组要钉的东西：
 *
 *   值钉到库里那一行     标题、正文、来源日期、`display_order`、`created_seq` 逐字段与
 *                        `db_growth_material` 和 `db_growth_book_time_topic` 比对
 *                        （CLAUDE.md §7.6：断言形状对每一个值都通过）
 *   主题顺序是派生的     期望顺序**从库里按服务端那条 ORDER BY 算出来**，不写死一串 id。
 *                        F19 §十一：取该主题全部活动的最早来源日期升序，空主题在后，
 *                        同日才用 `created_seq` 打破平手
 *   范围两头钉           看得见本班本学期那一份，**且上学期与别班那几条不在里面**
 *                        （§7.4）：教师 1 只看得到 compilation 2 的 topic 4／5／6，
 *                        看不到同班上学期的 1／2／3，也看不到大二班的 10／11／12；
 *                        换教师 3 登录，两边正好互换
 *   F29 主题只属 `m1`    `m2`（社区投稿）的 `time_topic_id` 恒为 null，给它指派主题
 *                        回 422 `topic_not_applicable_to_source`，**且那一行不变**
 *   撤销 ≠ 删除          `time_topic_id` 传 null 之后素材**仍在册**（行还在、
 *                        `compilation_id` 没变），只有 `DELETE` 才让行消失
 *   删主题 ≠ 移出成长册  删掉主题之后，它下面那条素材的行**还在**，只是
 *                        `time_topic_id` 变成 null
 *   负例都要「拒了且一行没改」（§7.5，只测状态码等于没测）：
 *     别班的 id 单发     `renameTopic`／`deleteTopic`／`removeMaterial` 拿大二班的 id
 *                        各发一次，全回 404（§2.3：不在范围内与不存在逐字节相同），
 *                        且那一行与它下面那批素材的 `time_topic_id` 逐条没变
 *     别班的素材混进名单  `assignTopic([自己的, 大二班的], topic)` 回 422
 *                        `scope_violation`，**两条素材的 `time_topic_id` 逐条没变** ——
 *                        钉的是服务端那条 all-or-nothing 的 ROLLBACK
 *     碰已锁的 e2 编册    `deleteTopic(1)`（compilation 1 已 `e2`）回 409
 *                        `compilation_locked`，**且 topic 1 还在、它下面那 4 条素材的
 *                        `time_topic_id` 仍全是 1** —— 服务端删主题必须先清后删，
 *                        清了一半再拒就是「拒绝了却改了一半」
 *   POST 的四条 409      `moment_not_published`（`s1` 草稿）／`moment_out_of_term`
 *                        （上学期那一则）／`source_already_in_compilation`（收过了）／
 *                        别班的 moment 回 404，每一条都断言 `db_growth_material`
 *                        的行数没变
 *
 * 写入那一半**自己造行**：数据集里大一班本学期 7 则 `s3` 在园时光已经全部入册
 * （compilation 2 的 `m1` 恰好 7 条，moment 13—19），所以 `POST /materials` 在原数据集
 * 上没有成功路径。探针先建一则本班本学期的 `s3` 在园时光，跑完连同它一起删掉，
 * 逐表行数回到 `STATS.md` 的基线。
 *
 *   node tools/probe-growth-book.mjs
 *   node tools/probe-growth-book.mjs --base http://localhost:3861/api/v1   # 打另一个端口
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWxStub, scoreboard } from './lib/wx-stub.mjs';
import { testdataPath, DB_URL } from './lib/testdata-path.mjs';

installWxStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const MP = resolve(HERE, '..', 'miniprogram');
const TESTDATA = testdataPath();

const require_ = createRequire(import.meta.url);
const book = require_(resolve(MP, 'services', 'growth-book.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const config = require_(resolve(MP, 'config.js'));

// `--base <url>` 把请求改打到另一个端口。改了服务端要重启才生效，而 3860 那扇窗口
// 不一定是自己开的：另起一个 `PORT=3861 node server/server.mjs`，探针打它。
// `utils/request.js` 每次发出前都现读 `config.env.baseUrl`，改这一格就够。
const baseAt = process.argv.indexOf('--base');
if (baseAt !== -1 && process.argv[baseAt + 1]) config.env.baseUrl = process.argv[baseAt + 1];
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

// config.js 的 devSubjectId 是 1：陈静，大一班（class 1），school 1。
// 服务端的基准日是 2026-04-25，落在 2025-2026-2（2026-02-23…2026-07-10），
// 所以本班本学期的编册是 compilation 2（`e1`）。
const ME = { teacher_id: 1, class_id: 1, school_id: 1 };
const TERM = '2025-2026-2';
const MY_COMPILATION = 2;

// 同班上学期那一份，`e2` 已锁。碰它的写入必须被拒。
const LOCKED_COMPILATION = 1;
const LOCKED_TOPIC = 1;

// 大二班那位，用来钉范围的另一头（compilation 4，topic 10／11／12）。
const OTHER = { teacher_id: 3, class_id: 2, compilation_id: 4 };

// STATS.md 的基线。跑完必须回到这三个数。
const BASE_MOMENTS = 126;
const BASE_MATERIALS = 138;
const BASE_TOPICS = 36;

/** 探针自己造的行。收尾逐个删掉。 */
const made = { momentId: null, materialId: null, topicId: null };

async function counts() {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM db_moment) AS moments,
            (SELECT count(*)::int FROM db_growth_material) AS materials,
            (SELECT count(*)::int FROM db_growth_book_time_topic) AS topics`,
  );
  return r.rows[0];
}

/** 一条素材的库内原貌。`source_date` 取裸日期，与客户端读到的同口径。 */
async function materialRow(id) {
  const r = await db.query(
    `SELECT growth_material_id, compilation_id, time_topic_id, moment_id, parent_task_id,
            source_type, title, body_text, display_order,
            to_char(source_date, 'YYYY-MM-DD') AS source_date
       FROM db_growth_material WHERE growth_material_id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

async function topicRow(id) {
  const r = await db.query(
    `SELECT time_topic_id, compilation_id, title, created_seq, created_by
       FROM db_growth_book_time_topic WHERE time_topic_id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

/** 某个主题下全部素材的 `(id, time_topic_id)` 快照。用来证明「拒绝」是真的没清。 */
async function membersOf(topicId) {
  const r = await db.query(
    `SELECT growth_material_id, time_topic_id FROM db_growth_material
      WHERE time_topic_id = $1 ORDER BY growth_material_id`,
    [topicId],
  );
  return r.rows.map((x) => `${x.growth_material_id}:${x.time_topic_id}`).join(',');
}

/**
 * 断言这次写入被拒，**且点名的那几行一个字都没变**。
 *
 * 只看状态码不算过（§7.5）：一个回 409 却已经把 `time_topic_id` 清了一半的实作，
 * 只看码是看不出来的。
 */
async function refuses(label, call, expectCode, expectRule, snapshot) {
  const before = await snapshot();
  const beforeCounts = await counts();
  let code = '(没被拒)';
  let rule = '';
  try {
    await call();
  } catch (err) {
    code = err.code;
    rule = err.details ? String(err.details.rule || '') : '';
  }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  if (expectRule) {
    check(`${label} 的 details.rule 是 ${expectRule}`, rule === expectRule, `实际「${rule}」`);
  }
  const after = await snapshot();
  check(`${label} 之后点名的那几行一个字都没变`, after === before, `${before} → ${after}`);
  const afterCounts = await counts();
  check(`${label} 之后三张表的行数都没变`,
    afterCounts.moments === beforeCounts.moments
    && afterCounts.materials === beforeCounts.materials
    && afterCounts.topics === beforeCounts.topics,
    `${JSON.stringify(beforeCounts)} → ${JSON.stringify(afterCounts)}`);
}

/** 换一位教师登录，跑完这一段再换回去。 */
async function asTeacher(teacherId, fn) {
  const real = config.devSubjectId;
  session.clear();
  config.devSubjectId = teacherId;
  await auth.ensureSession();
  try {
    await fn();
  } finally {
    config.devSubjectId = real;
    session.clear();
    await auth.ensureSession();
  }
}

async function main() {
  await db.connect();

  const start = await counts();
  console.log(`基线：db_moment=${start.moments}，db_growth_material=${start.materials}，`
    + `db_growth_book_time_topic=${start.topics}`);
  check('db_moment 基线与 STATS.md 一致', start.moments === BASE_MOMENTS, `实际 ${start.moments}`);
  check('db_growth_material 基线与 STATS.md 一致', start.materials === BASE_MATERIALS, `实际 ${start.materials}`);
  check('db_growth_book_time_topic 基线与 STATS.md 一致', start.topics === BASE_TOPICS, `实际 ${start.topics}`);

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 读：主题清单的顺序是派生的 ───────────────────────────────────────── */

  // 期望顺序**照服务端那条 ORDER BY 从库里算**，不写死 [4,5,6]：写死的那一版
  // 在主题真的换序的那天会把一个正确的客户端判红（CLAUDE.md §7.6 同一条教训）。
  const expectTopics = (await db.query(
    `SELECT t.time_topic_id, t.title, t.created_seq
       FROM db_growth_book_time_topic t
      WHERE t.compilation_id = $1
      ORDER BY (SELECT min(gm.source_date) FROM db_growth_material gm
                 WHERE gm.time_topic_id = t.time_topic_id
                   AND gm.compilation_id = t.compilation_id) ASC NULLS LAST,
               t.created_seq ASC, t.time_topic_id ASC`,
    [MY_COMPILATION],
  )).rows;

  const topics = await book.listTopics();
  check(`本班本学期有 ${expectTopics.length} 个主题`,
    topics.length === expectTopics.length, `实际 ${topics.length} 个`);
  check('主题顺序与服务端那条 ORDER BY 逐条相同',
    topics.map((t) => t.id).join(',') === expectTopics.map((t) => t.time_topic_id).join(','),
    `实际 ${topics.map((t) => t.id).join(',')}，期望 ${expectTopics.map((t) => t.time_topic_id).join(',')}`);
  expectTopics.forEach((row, i) => {
    check(`主题 ${row.time_topic_id} 的标题与库里逐字相同`,
      topics[i] && topics[i].title === row.title, `实际「${topics[i] && topics[i].title}」`);
    check(`主题 ${row.time_topic_id} 的 created_seq 与库里相同`,
      topics[i] && topics[i].seq === row.created_seq, `实际 ${topics[i] && topics[i].seq}`);
  });

  // 范围两头钉（§7.4）：同班上学期那三个与大二班那三个都不许出现。
  const seen = new Set(topics.map((t) => t.id));
  check('看不到同班上学期（compilation 1，已 e2）的主题 1／2／3',
    ![1, 2, 3].some((id) => seen.has(id)), `实际 ${[...seen].join(',')}`);
  check('看不到大二班（compilation 4）的主题 10／11／12',
    ![10, 11, 12].some((id) => seen.has(id)), `实际 ${[...seen].join(',')}`);

  /* ── 读：素材清单 ─────────────────────────────────────────────────────── */

  const expectAll = (await db.query(
    `SELECT growth_material_id, source_type, time_topic_id, title, body_text, display_order,
            to_char(source_date, 'YYYY-MM-DD') AS source_date
       FROM db_growth_material WHERE compilation_id = $1
      ORDER BY source_date DESC, growth_material_id DESC`,
    [MY_COMPILATION],
  )).rows;

  const all = await book.listMaterials();
  check(`不带筛选取到 ${expectAll.length} 条素材`, all.length === expectAll.length, `实际 ${all.length} 条`);
  check('素材顺序是 source_date DESC, growth_material_id DESC',
    all.map((m) => m.id).join(',') === expectAll.map((m) => m.growth_material_id).join(','),
    `实际 ${all.map((m) => m.id).join(',')}`);
  expectAll.forEach((row, i) => {
    const got = all[i] || {};
    check(`素材 ${row.growth_material_id} 的标题与库里逐字相同`,
      got.title === row.title, `实际「${got.title}」`);
    check(`素材 ${row.growth_material_id} 的正文与库里逐字相同`,
      got.body === (row.body_text || ''), `实际「${got.body}」`);
    check(`素材 ${row.growth_material_id} 的来源日期与库里相同`,
      got.date === row.source_date, `实际 ${got.date}`);
    check(`素材 ${row.growth_material_id} 的 display_order 与库里相同`,
      got.order === row.display_order, `实际 ${got.order}`);
  });

  // F29：`m2` 的 `time_topic_id` 恒为 null。**从库里数，不写死 2**。
  const m2 = expectAll.filter((r) => r.source_type === 'm2');
  check(`本编册的 ${m2.length} 条 m2（社区投稿）在库里全是未归类`,
    m2.every((r) => r.time_topic_id === null), JSON.stringify(m2.map((r) => r.time_topic_id)));
  check('客户端读到的 m2 也全是 topicId=null',
    all.filter((m) => m.sourceType === 'm2').every((m) => m.topicId === null),
    JSON.stringify(all.filter((m) => m.sourceType === 'm2').map((m) => m.topicId)));

  const expectM1 = expectAll.filter((r) => r.source_type === 'm1');
  const m1 = await book.listMaterials('m1');
  check(`带 source_type=m1 只取到 ${expectM1.length} 条`,
    m1.length === expectM1.length, `实际 ${m1.length} 条`);
  check('带 source_type=m1 之后一条 m2 都没有',
    m1.every((m) => m.sourceType === 'm1'), JSON.stringify(m1.map((m) => m.sourceType)));

  /* ── 读：管理页那一份合成数据 ─────────────────────────────────────────── */

  const view = await book.loadTimeManage();
  check(`loadTimeManage 的 topicCount 与库里相同（${expectTopics.length}）`,
    view.topicCount === expectTopics.length, `实际 ${view.topicCount}`);
  check(`loadTimeManage 的 activityCount 只数 m1（${expectM1.length}）`,
    view.activityCount === expectM1.length, `实际 ${view.activityCount}`);
  const expectLoose = expectM1.filter((r) => r.time_topic_id === null).length;
  check(`loadTimeManage 的 ungroupedCount 与库里相同（${expectLoose}）`,
    view.ungroupedCount === expectLoose, `实际 ${view.ungroupedCount}`);
  check('每个主题下的素材条数与库里相同',
    view.topics.every((t) => t.count
      === expectM1.filter((r) => r.time_topic_id === t.id).length),
    JSON.stringify(view.topics.map((t) => [t.id, t.count])));
  check('主题内的素材按 display_order 升序',
    view.topics.every((t) => t.items.every((it, i) => i === 0 || t.items[i - 1].order <= it.order)),
    JSON.stringify(view.topics.map((t) => t.items.map((i) => i.order))));

  /* ── 范围的另一头：换教师 3（大二班）看，两边正好互换 ───────────────── */

  await asTeacher(OTHER.teacher_id, async () => {
    const hers = await book.listTopics();
    const herIds = new Set(hers.map((t) => t.id));
    const expectHers = (await db.query(
      'SELECT time_topic_id FROM db_growth_book_time_topic WHERE compilation_id = $1 ORDER BY time_topic_id',
      [OTHER.compilation_id],
    )).rows.map((r) => r.time_topic_id);
    check(`教师 3 看到大二班本学期的 ${expectHers.length} 个主题`,
      expectHers.every((id) => herIds.has(id)) && hers.length === expectHers.length,
      `实际 ${[...herIds].join(',')}`);
    check('教师 3 看不到大一班的主题 4／5／6',
      ![4, 5, 6].some((id) => herIds.has(id)), `实际 ${[...herIds].join(',')}`);
  });

  /* ── 写：自己造一则本班本学期的 s3 在园时光 ───────────────────────────── */

  // 数据集里大一班本学期的 s3 已经全部入册，所以 POST 在原数据上没有成功路径。
  // 这一则由探针建，收尾时删掉。日期取学期区间内、不与既有素材撞的一天。
  made.momentId = (await db.query(
    `INSERT INTO db_moment (school_id, class_id, teacher_id, moment_title, moment_content,
                            moment_date, week_key, publish_status, published_at)
     VALUES ($1, $2, $3, '探针：龙舟鼓点里的节奏', '探针建的一则在园时光，跑完删掉。',
             '2026-04-22', '2026-W17', 's3', '2026-04-22 10:00:00')
     RETURNING moment_id`,
    [ME.school_id, ME.class_id, ME.teacher_id],
  )).rows[0].moment_id;

  const beforeMax = (await db.query(
    'SELECT COALESCE(max(display_order), 0)::int AS n FROM db_growth_material WHERE compilation_id = $1',
    [MY_COMPILATION],
  )).rows[0].n;

  const created = await book.addMoment(made.momentId);
  made.materialId = created.growth_material_id;
  const createdRow = await materialRow(made.materialId);
  check('POST /materials 建出来的行确实在库里', Boolean(createdRow), '库里查不到');
  check('新素材落在本班本学期的 compilation 2',
    createdRow && createdRow.compilation_id === MY_COMPILATION, `实际 ${createdRow && createdRow.compilation_id}`);
  check('新素材的 source_type 是 m1，parent_task_id 为 null',
    createdRow && createdRow.source_type === 'm1' && createdRow.parent_task_id === null,
    JSON.stringify(createdRow));
  check('新素材建立后默认未归类（time_topic_id 为 null）',
    createdRow && createdRow.time_topic_id === null, `实际 ${createdRow && createdRow.time_topic_id}`);
  check('新素材的 title 是从 db_moment.moment_title 抄的副本',
    createdRow && createdRow.title === '探针：龙舟鼓点里的节奏', `实际「${createdRow && createdRow.title}」`);
  check('新素材的 body_text 是从 db_moment.moment_content 抄的副本',
    createdRow && createdRow.body_text === '探针建的一则在园时光，跑完删掉。',
    `实际「${createdRow && createdRow.body_text}」`);
  check('新素材的 source_date 是从 db_moment.moment_date 抄的副本',
    createdRow && createdRow.source_date === '2026-04-22', `实际 ${createdRow && createdRow.source_date}`);
  check(`新素材的 display_order 接在本编册现有最大值之后（${beforeMax} + 1）`,
    createdRow && createdRow.display_order === beforeMax + 1, `实际 ${createdRow && createdRow.display_order}`);

  const afterCreate = await book.loadTimeManage();
  check('新素材出现在未归类清单里',
    afterCreate.ungrouped.some((m) => m.id === made.materialId),
    JSON.stringify(afterCreate.ungrouped.map((m) => m.id)));
  check(`未归类计数从 ${expectLoose} 变成 ${expectLoose + 1}`,
    afterCreate.ungroupedCount === expectLoose + 1, `实际 ${afterCreate.ungroupedCount}`);

  /* ── 写：新建主题 ─────────────────────────────────────────────────────── */

  const beforeSeq = (await db.query(
    'SELECT COALESCE(max(created_seq), 0)::int AS n FROM db_growth_book_time_topic WHERE compilation_id = $1',
    [MY_COMPILATION],
  )).rows[0].n;

  const topic = await book.createTopic('探针主题·龙舟鼓点');
  made.topicId = topic.time_topic_id;
  const topicRowNow = await topicRow(made.topicId);
  check('POST /time-topics 建出来的行确实在库里', Boolean(topicRowNow), '库里查不到');
  check('新主题落在本班本学期的 compilation 2',
    topicRowNow && topicRowNow.compilation_id === MY_COMPILATION, `实际 ${topicRowNow && topicRowNow.compilation_id}`);
  check('新主题的 title 逐字落库（#63：这一格就是那个既在 SELECT 列表又在 WHERE 里的 $1）',
    topicRowNow && topicRowNow.title === '探针主题·龙舟鼓点', `实际「${topicRowNow && topicRowNow.title}」`);
  check(`新主题的 created_seq 接在现有最大值之后（${beforeSeq} + 1）`,
    topicRowNow && topicRowNow.created_seq === beforeSeq + 1, `实际 ${topicRowNow && topicRowNow.created_seq}`);
  check('新主题的 created_by 是登录的这位教师（服务端派生，客户端没发）',
    topicRowNow && topicRowNow.created_by === ME.teacher_id, `实际 ${topicRowNow && topicRowNow.created_by}`);

  // 空主题排在有活动的主题之后（F19 §十一）。刚建的这个还没有活动。
  const withEmpty = await book.listTopics();
  check('刚建的空主题排在全部有活动的主题之后',
    withEmpty[withEmpty.length - 1] && withEmpty[withEmpty.length - 1].id === made.topicId,
    `实际末位是 ${withEmpty[withEmpty.length - 1] && withEmpty[withEmpty.length - 1].id}`);

  /* ── 写：归类、撤销、重命名 ───────────────────────────────────────────── */

  await book.assignTopic([made.materialId], made.topicId);
  check('归类之后库里那一行的 time_topic_id 是新主题',
    (await materialRow(made.materialId)).time_topic_id === made.topicId,
    `实际 ${(await materialRow(made.materialId)).time_topic_id}`);

  await book.assignTopic([made.materialId], null);
  const afterUndo = await materialRow(made.materialId);
  check('撤销归类之后 time_topic_id 回到 null', afterUndo.time_topic_id === null,
    `实际 ${afterUndo.time_topic_id}`);
  check('撤销归类**不解除入册关系** —— 行还在，compilation_id 没变',
    afterUndo.compilation_id === MY_COMPILATION, JSON.stringify(afterUndo));

  await book.renameTopic(made.topicId, '探针主题·改名');
  check('重命名之后库里的 title 逐字相同',
    (await topicRow(made.topicId)).title === '探针主题·改名',
    `实际「${(await topicRow(made.topicId)).title}」`);

  /* ── 负例一：别班的素材混进名单 —— 整发拒绝，一行不改 ─────────────────── */

  const outsiderMaterial = (await db.query(
    'SELECT growth_material_id FROM db_growth_material WHERE compilation_id = $1 AND source_type = $2 ORDER BY growth_material_id LIMIT 1',
    [OTHER.compilation_id, 'm1'],
  )).rows[0].growth_material_id;

  const pairSnapshot = async () => {
    const a = await materialRow(made.materialId);
    const b = await materialRow(outsiderMaterial);
    return `${a.time_topic_id}|${b.time_topic_id}`;
  };
  await refuses(
    `名单里混进大二班的素材 ${outsiderMaterial}`,
    () => book.assignTopic([made.materialId, outsiderMaterial], made.topicId),
    'scope_violation', 'not_in_this_compilation', pairSnapshot,
  );

  /* ── 负例一之二：拿别班的 id 直接改与直接删 —— 一律 404，且一行不改 ────── */
  //
  // 上一发钉的是「名单里混进别班的一条」。这三发钉的是**单个 id 的三条写入端点**：
  // 重命名主题、删除主题、移出素材各自的范围 predicate 都内联在自己那条 SQL 里，
  // 别班的 id 命中零行（红线 1）。§2.3 要求「不在范围内」与「不存在」逐字节相同，
  // 所以三发都回 404，不回 403。删主题那一发还要证明**先清后删的那一步也没清**。

  const outsiderTopic = (await db.query(
    'SELECT time_topic_id FROM db_growth_book_time_topic WHERE compilation_id = $1 ORDER BY time_topic_id LIMIT 1',
    [OTHER.compilation_id],
  )).rows[0].time_topic_id;

  await refuses(
    `重命名大二班的主题 ${outsiderTopic}`,
    () => book.renameTopic(outsiderTopic, '探针越权改名'),
    'not_found', '',
    async () => JSON.stringify(await topicRow(outsiderTopic)),
  );

  await refuses(
    `删除大二班的主题 ${outsiderTopic}`,
    () => book.deleteTopic(outsiderTopic),
    'not_found', '',
    async () => `${(await topicRow(outsiderTopic)) ? 'topic在' : 'topic没了'}/${await membersOf(outsiderTopic)}`,
  );

  await refuses(
    `移出大二班的素材 ${outsiderMaterial}`,
    () => book.removeMaterial(outsiderMaterial),
    'not_found', '',
    async () => JSON.stringify(await materialRow(outsiderMaterial)),
  );

  /* ── 负例二：给 m2 指派主题（F29） ────────────────────────────────────── */

  const someM2 = m2.length ? m2[0].growth_material_id : null;
  if (someM2) {
    await refuses(
      `给 m2 素材 ${someM2}（社区投稿）指派主题`,
      () => book.assignTopic([someM2], made.topicId),
      'validation_failed', 'topic_not_applicable_to_source',
      async () => String((await materialRow(someM2)).time_topic_id),
    );
  } else {
    note('本编册今天没有 m2 素材，F29 的那一条负例跑不到',
      `compilation ${MY_COMPILATION} 的 m2 行数为 0`);
  }

  /* ── 负例三：碰同班上学期那份已锁的 e2 编册 —— 拒了，且一行没清 ─────────── */

  // 服务端删主题必须先清 time_topic_id 再删主题（FK 方向决定），所以「清了一半再拒」
  // 是这一族最容易出的错。快照钉的正是那几行。
  //
  // 回的是 404，不是 409 `compilation_locked`：登记表 `time_topic.delete`／
  // `growth_material.delete` 的前置有 `term_scope_inline`，上学期的行落在范围之外，
  // 与「不存在」逐字节相同（§2.3），服务端不泄露「有这么一行，只是锁了」。
  // 409 那一支要本学期的编册是 e2 才走得到，本数据集里 compilation 2 是 e1，
  // 本探针也不去锁它（锁是单向的），所以那一支今天到不了 —— 见下面那条 note。
  await refuses(
    `删同班上学期（compilation ${LOCKED_COMPILATION}，已 e2）的主题 ${LOCKED_TOPIC}`,
    () => book.deleteTopic(LOCKED_TOPIC),
    'not_found', '',
    async () => `${(await topicRow(LOCKED_TOPIC)) ? 'topic在' : 'topic没了'}/${await membersOf(LOCKED_TOPIC)}`,
  );

  const lockedMaterial = (await db.query(
    'SELECT growth_material_id FROM db_growth_material WHERE compilation_id = $1 ORDER BY growth_material_id LIMIT 1',
    [LOCKED_COMPILATION],
  )).rows[0].growth_material_id;
  await refuses(
    `移出同班上学期（compilation ${LOCKED_COMPILATION}，已 e2）的素材 ${lockedMaterial}`,
    () => book.removeMaterial(lockedMaterial),
    'not_found', '',
    async () => JSON.stringify(await materialRow(lockedMaterial)),
  );
  note('409 `compilation_locked`（本学期编册已 e2 时删主题／移出素材）这一支本数据集到不了',
    `compilation ${MY_COMPILATION} 是 e1，上学期那份 e2 落在 term 范围之外回 404`);

  /* ── 负例四：主题重名 ─────────────────────────────────────────────────── */

  await refuses(
    `新建与既有主题「${expectTopics[0].title}」同名的主题`,
    () => book.createTopic(expectTopics[0].title),
    'validation_failed', 'topic_title_duplicated',
    async () => String((await counts()).topics),
  );

  /* ── 负例五：POST /materials 的四条前置 ───────────────────────────────── */

  const draft = (await db.query(
    "SELECT moment_id FROM db_moment WHERE class_id = $1 AND publish_status = 's1' ORDER BY moment_id LIMIT 1",
    [ME.class_id],
  )).rows[0];
  if (draft) {
    await refuses(`把草稿在园时光 ${draft.moment_id}（s1）收进编册`,
      () => book.addMoment(draft.moment_id),
      'state_precondition_failed', 'moment_not_published',
      async () => String((await counts()).materials));
  } else {
    note('本班今天没有 s1 草稿在园时光，moment_not_published 那一条负例跑不到', 'class 1 的 s1 行数为 0');
  }

  const lastTerm = (await db.query(
    `SELECT m.moment_id FROM db_moment m
       JOIN db_school_term st ON st.school_id = m.school_id AND st.term_id <> $2
      WHERE m.class_id = $1 AND m.publish_status = 's3'
        AND m.moment_date BETWEEN st.start_date AND st.end_date
      ORDER BY m.moment_id LIMIT 1`,
    [ME.class_id, TERM],
  )).rows[0];
  if (lastTerm) {
    await refuses(`把上学期的在园时光 ${lastTerm.moment_id} 收进本学期编册`,
      () => book.addMoment(lastTerm.moment_id),
      'state_precondition_failed', 'moment_out_of_term',
      async () => String((await counts()).materials));
  } else {
    note('本班今天没有上学期的 s3 在园时光，moment_out_of_term 那一条负例跑不到', 'class 1 的上学期 s3 行数为 0');
  }

  const already = (await db.query(
    'SELECT moment_id FROM db_growth_material WHERE compilation_id = $1 AND source_type = $2 AND moment_id <> $3 ORDER BY growth_material_id LIMIT 1',
    [MY_COMPILATION, 'm1', made.momentId],
  )).rows[0];
  await refuses(`把已经收过的在园时光 ${already.moment_id} 再收一次`,
    () => book.addMoment(already.moment_id),
    'state_precondition_failed', 'source_already_in_compilation',
    async () => String((await counts()).materials));

  const otherClassMoment = (await db.query(
    "SELECT moment_id FROM db_moment WHERE class_id = $1 AND publish_status = 's3' ORDER BY moment_id LIMIT 1",
    [OTHER.class_id],
  )).rows[0].moment_id;
  await refuses(`把大二班的在园时光 ${otherClassMoment} 收进大一班的编册`,
    () => book.addMoment(otherClassMoment),
    'not_found', '',
    async () => String((await counts()).materials));

  /* ── 写：删主题 = 集体撤销归类，素材留在册里 ──────────────────────────── */

  await book.assignTopic([made.materialId], made.topicId);
  await book.deleteTopic(made.topicId);
  check('删主题之后那一行主题真的没了', (await topicRow(made.topicId)) === null, '库里还查得到');
  const afterTopicDelete = await materialRow(made.materialId);
  check('删主题之后它下面那条素材**还在册**（行没消失）',
    Boolean(afterTopicDelete) && afterTopicDelete.compilation_id === MY_COMPILATION,
    JSON.stringify(afterTopicDelete));
  check('删主题之后那条素材的 time_topic_id 被清成 null',
    afterTopicDelete && afterTopicDelete.time_topic_id === null,
    `实际 ${afterTopicDelete && afterTopicDelete.time_topic_id}`);
  made.topicId = null;

  /* ── 写：移出编册 = 行真的消失，来源不动 ──────────────────────────────── */

  await book.removeMaterial(made.materialId);
  check('DELETE /materials 之后那一行真的消失', (await materialRow(made.materialId)) === null, '库里还查得到');
  const srcStill = (await db.query(
    'SELECT moment_id, publish_status FROM db_moment WHERE moment_id = $1', [made.momentId],
  )).rows[0];
  check('移出编册**不动来源在园时光**（源 db_moment 那一行还在、状态没变）',
    Boolean(srcStill) && srcStill.publish_status === 's3', JSON.stringify(srcStill));
  made.materialId = null;
}

/**
 * 收拾：探针自己造的三行逐个删掉，再核对逐表行数回到 `STATS.md` 的基线。
 *
 * **本探针改的全是自己建的行**，所以收拾是「删掉」而不是「写回」。顺序按外键来：
 * 素材指着主题与 moment，所以先素材、再主题、最后 moment。
 */
async function cleanup() {
  if (made.materialId) {
    await db.query('DELETE FROM db_growth_material WHERE growth_material_id = $1', [made.materialId]);
  }
  if (made.topicId) {
    await db.query('UPDATE db_growth_material SET time_topic_id = NULL WHERE time_topic_id = $1', [made.topicId]);
    await db.query('DELETE FROM db_growth_book_time_topic WHERE time_topic_id = $1', [made.topicId]);
  }
  if (made.momentId) {
    await db.query('DELETE FROM db_growth_material WHERE moment_id = $1', [made.momentId]);
    await db.query('DELETE FROM db_file_ref WHERE owner_object = $1 AND owner_id = $2',
      ['db_moment', made.momentId]);
    await db.query('DELETE FROM db_moment WHERE moment_id = $1', [made.momentId]);
  }
  const end = await counts();
  check(`逐表行数回到 STATS.md 的基线（db_moment=${BASE_MOMENTS}，db_growth_material=${BASE_MATERIALS}，`
    + `db_growth_book_time_topic=${BASE_TOPICS}）`,
    end.moments === BASE_MOMENTS && end.materials === BASE_MATERIALS && end.topics === BASE_TOPICS,
    JSON.stringify(end));
}

// 带超时：死锁要红，不要挂住（与 probe-session 同一条理由）。
const timer = setTimeout(() => {
  console.error('探针超时（60s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 60_000);
timer.unref();

// 收拾放在**尾链上**，不放在 main() 里：main() 中途抛错时也要把自己建的行删掉。
main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  .then(async () => {
    try {
      await cleanup();
    } catch (err) {
      check(`收拾失败，探针建的行可能还留在库里（moment=${made.momentId}／`
        + `material=${made.materialId}／topic=${made.topicId}）：${err && err.message}`, false);
    }
    try { await db.end(); } catch { /* 已经断开就算了 */ }
    clearTimeout(timer);
    sb.report();
  });
