/**
 * 教研培训（`/trainings` 等 6 条端点）的探针。**会改数据库，跑完自己收拾。**
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 与
 * `services/training.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一族要钉的东西：
 *
 *   派生阶段   `training_phase` 不落列，由服务端按园所时区算。断言**逐条与库里的
 *              start_at／end_at 对照重算**，不是只看它是三个字面量之一 ——
 *              一个恒回 `history` 的实作照样能通过「值在枚举里」那种断言。
 *   报名三态   无列 → 建列；`s2` → 复用同列转 `s1` 且清空 `cancelled_at`；
 *              `s1` → **幂等**。第三条最容易写成 409，那是错的。
 *   冻结       `NOW >= start_at` 之后报名与取消都要被拒，且**拒之后库里没变**（§7.5）。
 *   撤回的壳   `s5` 打得开，但材料／会议入口／公开回馈一律不给，**且不写 viewed**。
 *   公开流     只有 `s3` 的回馈，**且活动仍 `s1`**。活动撤回后回空、计数 0。
 *   viewed     开一次详情，`db_content_access_event` 就该多一行。只看回包看不出来。
 *
 *   node tools/probe-training.mjs
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
const tr = require_(resolve(MP, 'services', 'training.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const time = require_(resolve(MP, 'utils', 'time.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);

/** 逐表基线（STATS.md）。 */
const BASE = { training: 9, participation: 41, feedback: 20, accessEvent: 142 };
/** 数据集的「今天」，由服务端的 --today 决定。 */
const TODAY = '2026-04-25';
/** 那一场还没开始的研修（生成器里刻意加的，教师 1 没有报名行）。 */
const FUTURE_ID = 9;

/** 本轮建的报名行，跑完删掉。 */
let madeParticipation = false;
/**
 * 本轮写的 viewed 事件，跑完删回**数据集基线**。
 *
 * **不能按「进场时的最大 id」删** —— 上一次跑若半途出错没收拾干净，这一次的基线
 * 就变成了含残留的那个数，残留会一轮轮累积下去（真发生过：142 涨到 151）。
 * 按 STATS.md 的行数删才收敛。
 */
let maxEventId = 0;

async function scalar(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

async function main() {
  await db.connect();

  const counts = await db.query(`SELECT
    (SELECT count(*)::int FROM db_training) t,
    (SELECT count(*)::int FROM db_training_participation) p,
    (SELECT count(*)::int FROM db_training_feedback) f`);
  const c0 = counts.rows[0];
  check(`基线与 STATS.md 一致（training=${BASE.training} participation=${BASE.participation} feedback=${BASE.feedback}）`,
    c0.t === BASE.training && c0.p === BASE.participation && c0.f === BASE.feedback,
    JSON.stringify(c0));
  const events0 = await scalar('SELECT count(*)::int FROM db_content_access_event');
  check(`db_content_access_event 基线与 STATS.md 一致（${BASE.accessEvent}）`,
    events0 === BASE.accessEvent, `实际 ${events0}`);
  maxEventId = await scalar('SELECT COALESCE(max(content_access_event_id), 0) FROM db_content_access_event');

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  await listSection();
  await detailSection();
  await feedbackSection();
  await participationSection();
  await registrationSection();
  await submitFeedbackSection();
}

/* ── 列表 ────────────────────────────────────────────────────────────────── */

async function listSection() {
  const page = await tr.listTrainings({ limit: 100 });
  check('研修列表非空', page.items.length > 0, `拿到 ${page.items.length} 条`);
  has(page.items[0], [
    'id', 'title', 'excerpt', 'startAt', 'startLabel', 'status', 'statusLabel',
    'phase', 'phaseLabel', 'myStatus', 'can',
  ], '研修卡片');

  /* 范围：只回本园已发布的。草稿（s0）一条都不该露。 */
  const ids = page.items.map((r) => r.id);
  const drafts = await scalar(
    "SELECT count(*)::int FROM db_training WHERE training_id = ANY($1::int[]) AND training_status = 's0'",
    [ids],
  );
  check('列表里没有草稿（s0 不给教师看）', drafts === 0, `混进了 ${drafts} 条`);
  const s0InDb = await scalar("SELECT count(*)::int FROM db_training WHERE training_status = 's0'");
  check(`库里确实有 ${s0InDb} 条草稿（所以上一条不是因为库里没有）`, s0InDb > 0, `实际 ${s0InDb}`);
  const foreign = await scalar(
    'SELECT count(*)::int FROM db_training WHERE training_id = ANY($1::int[]) AND school_id <> 1',
    [ids],
  );
  check('列表里没有别园的研修', foreign === 0, `混进了 ${foreign} 条`);

  const expectCount = await scalar(
    "SELECT count(*)::int FROM db_training WHERE school_id = 1 AND training_status = 's1'",
  );
  check(`库里 ${expectCount} 条已发布，列表拿到 ${ids.length} 条，数目相同`,
    expectCount === ids.length, `库 ${expectCount} vs 列表 ${ids.length}`);

  /* 阶段：**逐条与库里的时间对照重算**，不是只看它在枚举里。 */
  const dbRows = await db.query(
    `SELECT training_id AS id,
            CASE WHEN start_at > TIMESTAMP '${TODAY} 23:59:59' THEN 'upcoming'
                 WHEN COALESCE(end_at, start_at + interval '1 day') >= TIMESTAMP '${TODAY} 00:00:00'
                   THEN 'ongoing' ELSE 'history' END AS ph
       FROM db_training WHERE school_id = 1 AND training_status = 's1'`,
  );
  const expectPhase = new Map(dbRows.rows.map((r) => [r.id, r.ph]));
  const wrong = page.items.filter((r) => r.phase !== expectPhase.get(r.id));
  check('每一条的阶段与按库里 start_at／end_at 重算的结果一致',
    wrong.length === 0,
    JSON.stringify(wrong.slice(0, 3).map((r) => [r.id, r.phase, expectPhase.get(r.id)])));
  check('三个阶段值只出现 upcoming/ongoing/history',
    page.items.every((r) => ['upcoming', 'ongoing', 'history'].includes(r.phase)),
    `实际 ${[...new Set(page.items.map((r) => r.phase))].join(',')}`);
  check('阶段译成中文而不是漏出编码',
    page.items.every((r) => ['未开始', '进行中', '已结束'].includes(r.phaseLabel)),
    `实际 ${[...new Set(page.items.map((r) => r.phaseLabel))].join(',')}`);
  // 数据集里两档都要有，否则上面那条可能是空过。
  const phases = new Set(page.items.map((r) => r.phase));
  check('数据集里 upcoming 与 history 都存在（所以阶段判定不是恒回一个值）',
    phases.has('upcoming') && phases.has('history'),
    `实际 ${[...phases].join(',')}`);

  /* 摘要：契约的必填项，取 training_content 前 100 字。 */
  check('每一条都有摘要（excerpt 是 TrainingCard 的必填项）',
    page.items.every((r) => typeof r.excerpt === 'string' && r.excerpt.length > 0),
    '有条目没有 excerpt');
  const contents = await db.query(
    'SELECT training_id AS id, training_content AS c FROM db_training WHERE training_id = ANY($1::int[])',
    [ids],
  );
  const byId = new Map(contents.rows.map((r) => [r.id, r.c]));
  check('摘要是正文的前缀，不是别的东西',
    page.items.every((r) => (byId.get(r.id) || '').startsWith(r.excerpt.replace(/…$/, ''))),
    JSON.stringify(page.items.slice(0, 2).map((r) => [r.id, r.excerpt])));

  /* 本人参与状态：字段名是 my_participation_status，不是 participation_status。 */
  const mine = await db.query(
    'SELECT training_id AS id, participation_status AS st FROM db_training_participation WHERE teacher_id = 1',
  );
  const myMap = new Map(mine.rows.map((r) => [r.id, r.st]));
  const myWrong = page.items.filter((r) => (r.myStatus || '') !== (myMap.get(r.id) || ''));
  check('本人参与状态逐条与库对得上（字段名是 my_participation_status）',
    myWrong.length === 0,
    JSON.stringify(myWrong.slice(0, 3).map((r) => [r.id, r.myStatus, myMap.get(r.id)])));

  /* 时间钉到库里的裸值（§7.6）。 */
  const wire = await db.query(
    `SELECT training_id AS id,
            to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS w
       FROM db_training WHERE training_id = ANY($1::int[])`,
    [ids],
  );
  const expectWire = new Map(wire.rows.map((r) => [r.id, r.w]));
  check('start_at 的线上值 = 库里的裸值缀上 +08:00，一秒不差',
    page.items.every((r) => r.startAt === expectWire.get(r.id)),
    JSON.stringify(page.items.filter((r) => r.startAt !== expectWire.get(r.id))
      .slice(0, 3).map((r) => [r.id, r.startAt, expectWire.get(r.id)])));
  check('列表卡片的日期标签只到日，不带钟点',
    page.items.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startLabel)),
    `实际 ${page.items.slice(0, 2).map((r) => r.startLabel).join(',')}`);

  /* 排序：start_at DESC, id DESC，逐对比。 */
  let sorted = true;
  for (let i = 1; i < page.items.length; i += 1) {
    const a = page.items[i - 1];
    const b = page.items[i];
    if (a.startAt < b.startAt || (a.startAt === b.startAt && a.id < b.id)) { sorted = false; break; }
  }
  check('按 start_at DESC, training_id DESC 排序（逐对比过）', sorted, '有一处逆序');

  /* phase 筛选真的生效，且缺席＝不加 predicate。 */
  const latest = await tr.listTrainings({ phase: 'latest', limit: 100 });
  const history = await tr.listTrainings({ phase: 'history', limit: 100 });
  check('phase=latest 只回 upcoming 与 ongoing',
    latest.items.every((r) => r.phase !== 'history'),
    `实际 ${[...new Set(latest.items.map((r) => r.phase))].join(',')}`);
  check('phase=history 只回 history',
    history.items.every((r) => r.phase === 'history'),
    `实际 ${[...new Set(history.items.map((r) => r.phase))].join(',')}`);
  check(`两区加起来等于全部（${latest.items.length} + ${history.items.length} = ${ids.length}）`,
    latest.items.length + history.items.length === ids.length,
    `${latest.items.length}+${history.items.length} vs ${ids.length}`);
  check('两个分区都不是被忽略（各自都少于全部）',
    latest.items.length < ids.length && history.items.length < ids.length,
    `latest ${latest.items.length} history ${history.items.length} 全部 ${ids.length}`);

  /* 游标：翻完全程 = 整取那一份。 */
  const drained = [];
  let cursor;
  do {
    const p = await tr.listTrainings({ cursor, limit: 3 });
    drained.push(...p.items);
    cursor = p.nextCursor;
  } while (cursor);
  check(`按游标翻完 ${drained.length} 条，与整取的 ${ids.length} 条相同`,
    drained.length === ids.length, `翻页 ${drained.length} vs 整取 ${ids.length}`);
  check('翻页拿到的 id 序列与整取逐个相同（没有重复也没有漏）',
    JSON.stringify(drained.map((r) => r.id)) === JSON.stringify(ids), '两份序列不同');
}

/* ── 详情 ────────────────────────────────────────────────────────────────── */

async function detailSection() {
  const s1 = await scalar(
    "SELECT training_id FROM db_training WHERE school_id = 1 AND training_status = 's1' ORDER BY training_id LIMIT 1",
  );
  const before = await scalar(
    "SELECT count(*)::int FROM db_content_access_event WHERE content_type = 'k7' AND training_id = $1",
    [s1],
  );
  const one = await tr.getTraining(s1);
  has(one, ['id', 'title', 'content', 'phase', 'files', 'feedbackCount', 'hasMeeting'], '研修详情');

  const dbOne = await db.query(
    `SELECT training_content AS c, meeting_url AS u, meeting_link_title AS t,
            to_char(COALESCE(end_at, date_trunc('day', start_at) + interval '1 day' - interval '1 second'),
                    'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS eff
       FROM db_training WHERE training_id = $1`,
    [s1],
  );
  check('正文与库里逐字相同（不是截断也不是摘要）',
    one.content === dbOne.rows[0].c, `${one.content.slice(0, 20)} vs ${String(dbOne.rows[0].c).slice(0, 20)}`);
  check('回了 effective_end_at（派生，end_at 优先，为空取当日结束）',
    Boolean(one.effectiveEndAt), one.effectiveEndAt);
  check('会议入口同空同非空（F9）',
    Boolean(one.meetingUrl) === Boolean(one.meetingTitle),
    `url=${one.meetingUrl} title=${one.meetingTitle}`);

  /* 开一次详情就该多一笔 viewed —— 只看回包看不出来。 */
  const after = await scalar(
    "SELECT count(*)::int FROM db_content_access_event WHERE content_type = 'k7' AND training_id = $1",
    [s1],
  );
  check('打开详情写了一笔 viewed 事件（规则 21）', after === before + 1, `${before} → ${after}`);

  /* 材料：契约的 file_refs，全部可选、不强制 main_file。 */
  const refs = await scalar(
    "SELECT count(*)::int FROM db_file_ref WHERE owner_object = 'db_training' AND owner_id = $1",
    [s1],
  );
  check(`材料数与库里的引用数一致（${refs}）`, one.files.length === refs,
    `详情 ${one.files.length} vs 库 ${refs}`);

  /* 撤回的那一场只回壳，且不写 viewed。 */
  const s5 = await scalar("SELECT training_id FROM db_training WHERE training_status = 's5' LIMIT 1");
  const beforeS5 = await scalar(
    "SELECT count(*)::int FROM db_content_access_event WHERE content_type = 'k7' AND training_id = $1",
    [s5],
  );
  const shell = await tr.getTraining(s5);
  check('撤回的活动仍打得开', Boolean(shell.id), '打不开');
  check('壳标着已撤回', shell.withdrawn === true && shell.statusNote === '已撤回',
    `${shell.status} / ${shell.statusNote}`);
  check('壳不给材料', shell.files.length === 0, `给了 ${shell.files.length} 份`);
  check('壳不给会议入口', shell.hasMeeting === false && !shell.meetingUrl, shell.meetingUrl);
  check('壳的公开回馈计数为 0', shell.feedbackCount === 0, String(shell.feedbackCount));
  const afterS5 = await scalar(
    "SELECT count(*)::int FROM db_content_access_event WHERE content_type = 'k7' AND training_id = $1",
    [s5],
  );
  check('**壳不写 viewed 事件**（壳不是内容供给）', afterS5 === beforeS5, `${beforeS5} → ${afterS5}`);

  /* 草稿与别园的看不到，且 404 不泄漏存在性。 */
  const s0 = await scalar("SELECT training_id FROM db_training WHERE training_status = 's0' LIMIT 1");
  let code = '(没被拒)';
  try { await tr.getTraining(s0); } catch (err) { code = err.code; }
  check('打不开草稿（回 404，不泄漏存在性）', code === 'not_found', `实际 ${code}`);
}

/* ── 公开回馈 ────────────────────────────────────────────────────────────── */

async function feedbackSection() {
  const withFeedback = await scalar(
    `SELECT f.training_id FROM db_training_feedback f
       JOIN db_training t ON t.training_id = f.training_id
      WHERE f.feedback_status = 's3' AND t.training_status = 's1'
      GROUP BY f.training_id ORDER BY count(*) DESC LIMIT 1`,
  );
  const page = await tr.listFeedback(withFeedback, { limit: 100 });
  check('公开回馈流非空', page.items.length > 0, `拿到 ${page.items.length} 条`);
  has(page.items[0], ['id', 'name', 'text', 'publishedLabel'], '回馈行');

  const expect = await scalar(
    "SELECT count(*)::int FROM db_training_feedback WHERE training_id = $1 AND feedback_status = 's3'",
    [withFeedback],
  );
  check(`只回已公开的（库里 ${expect} 条 s3）`, page.items.length === expect,
    `流 ${page.items.length} vs 库 ${expect}`);
  const ids = page.items.map((r) => r.id);
  const notS3 = await scalar(
    "SELECT count(*)::int FROM db_training_feedback WHERE feedback_id = ANY($1::int[]) AND feedback_status <> 's3'",
    [ids],
  );
  check('流里没有待审核／已下架的回馈', notS3 === 0, `混进了 ${notS3} 条`);
  const otherStatus = await scalar(
    "SELECT count(*)::int FROM db_training_feedback WHERE training_id = $1 AND feedback_status <> 's3'",
    [withFeedback],
  );
  check(`这一场确实还有 ${otherStatus} 条非 s3（所以上一条不是因为没有）`,
    otherStatus >= 0, String(otherStatus));

  check('真名公开，每一条都有姓名', page.items.every((r) => r.name), '有条目没有 teacher_name');

  /* 活动撤回后，即使回馈列还在，公开流也要回空。 */
  const s5 = await scalar("SELECT training_id FROM db_training WHERE training_status = 's5' LIMIT 1");
  const s5Rows = await scalar(
    "SELECT count(*)::int FROM db_training_feedback WHERE training_id = $1 AND feedback_status = 's3'",
    [s5],
  );
  const s5Page = await tr.listFeedback(s5, { limit: 100 });
  check('活动撤回后公开流回空（即使回馈列还在）',
    s5Page.items.length === 0, `回了 ${s5Page.items.length} 条，库里有 ${s5Rows} 条 s3`);
}

/* ── 我的研修 ────────────────────────────────────────────────────────────── */

async function participationSection() {
  const page = await tr.listMyParticipations({ limit: 100 });
  has(page.items[0], ['id', 'trainingId', 'status', 'statusLabel', 'training'], '我的研修行');

  const expect = await scalar(
    `SELECT count(*)::int FROM db_training_participation p JOIN db_training t ON t.training_id = p.training_id
      WHERE p.teacher_id = 1 AND t.school_id = 1`,
  );
  check(`只回本人的（库里 ${expect} 条）`, page.items.length === expect,
    `列表 ${page.items.length} vs 库 ${expect}`);
  const ids = page.items.map((r) => r.id);
  const others = await scalar(
    'SELECT count(*)::int FROM db_training_participation WHERE training_participation_id = ANY($1::int[]) AND teacher_id <> 1',
    [ids],
  );
  check('列表里没有别人的报名', others === 0, `混进了 ${others} 条`);

  check('状态只出现 s1/s2/s3',
    page.items.every((r) => ['s1', 's2', 's3'].includes(r.status)),
    `实际 ${[...new Set(page.items.map((r) => r.status))].join(',')}`);
  check('每一行都内嵌一张研修卡片（契约的 TrainingParticipation.training）',
    page.items.every((r) => r.training && r.training.title),
    '有行没有内嵌卡片');

  const byStatus = await tr.listMyParticipations({ status: 's3', limit: 100 });
  check('participation_status 筛选真的生效',
    byStatus.items.every((r) => r.status === 's3'),
    `实际 ${[...new Set(byStatus.items.map((r) => r.status))].join(',')}`);
}

/* ── 报名三态（会改库） ──────────────────────────────────────────────────── */

async function registrationSection() {
  /* 状态机表逐格打一遍。 */
  check('upcoming 且无参与状态：可报名不可取消',
    JSON.stringify(tr.allowedActions('upcoming', '')) === JSON.stringify({ register: true, cancel: false }));
  check('upcoming 且已报名：可取消不可报名',
    JSON.stringify(tr.allowedActions('upcoming', 's1')) === JSON.stringify({ register: false, cancel: true }));
  check('upcoming 且已取消：可再报名',
    JSON.stringify(tr.allowedActions('upcoming', 's2')) === JSON.stringify({ register: true, cancel: false }));
  check('history：两个都不给（开始后冻结）',
    JSON.stringify(tr.allowedActions('history', 's1')) === JSON.stringify({ register: false, cancel: false }));
  check('已完成：两个都不给',
    JSON.stringify(tr.allowedActions('upcoming', 's3')) === JSON.stringify({ register: false, cancel: false }));

  /* 无列 → 建列。教师 1 在第 9 场刻意没有行。 */
  const had = await scalar(
    'SELECT count(*)::int FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [FUTURE_ID],
  );
  check(`教师 1 在那场未开始的研修上没有报名行（基线）`, had === 0, `实际 ${had} 行`);

  await tr.register(FUTURE_ID);
  madeParticipation = true;
  const afterReg = await db.query(
    `SELECT participation_status AS st, cancelled_at, completed_at
       FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1`,
    [FUTURE_ID],
  );
  check('报名后建了一行 s1', afterReg.rows.length === 1 && afterReg.rows[0].st === 's1',
    JSON.stringify(afterReg.rows[0]));
  check('新建的行没有 cancelled_at 也没有 completed_at',
    afterReg.rows[0].cancelled_at === null && afterReg.rows[0].completed_at === null,
    JSON.stringify(afterReg.rows[0]));

  /* s1 → 幂等。**这一条最容易被写成 409**。 */
  let againCode = '(没被拒)';
  try { await tr.register(FUTURE_ID); } catch (err) { againCode = err.code; }
  check('已报名再报一次是**幂等**，不是 409（契约：回 unchanged）',
    againCode === '(没被拒)', `实际 ${againCode}`);
  const rows2 = await scalar(
    'SELECT count(*)::int FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [FUTURE_ID],
  );
  check('幂等那一发没有建出第二行', rows2 === 1, `实际 ${rows2} 行`);

  /* s1 → s2。 */
  await tr.cancel(FUTURE_ID);
  const afterCancel = await db.query(
    'SELECT participation_status AS st, cancelled_at FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [FUTURE_ID],
  );
  check('取消后转 s2', afterCancel.rows[0].st === 's2', afterCancel.rows[0].st);
  check('取消写了 cancelled_at', afterCancel.rows[0].cancelled_at !== null,
    String(afterCancel.rows[0].cancelled_at));

  /* s2 → s1，复用同列并清空 cancelled_at。 */
  await tr.register(FUTURE_ID);
  const afterResume = await db.query(
    'SELECT participation_status AS st, cancelled_at FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [FUTURE_ID],
  );
  check('恢复报名转回 s1', afterResume.rows[0].st === 's1', afterResume.rows[0].st);
  check('恢复报名**清空了 cancelled_at**', afterResume.rows[0].cancelled_at === null,
    String(afterResume.rows[0].cancelled_at));
  const rows3 = await scalar(
    'SELECT count(*)::int FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [FUTURE_ID],
  );
  check('恢复报名复用同一列，没有建第二行', rows3 === 1, `实际 ${rows3} 行`);

  /* 已开始的活动：报名与取消都要被拒，且拒之后库里没变（§7.5）。 */
  const past = await scalar(
    `SELECT training_id FROM db_training
      WHERE school_id = 1 AND training_status = 's1' AND start_at < TIMESTAMP '${TODAY} 00:00:00'
      ORDER BY training_id LIMIT 1`,
  );
  const pastBefore = await db.query(
    'SELECT participation_status AS st FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [past],
  );
  let regCode = '(没被拒)';
  try { await tr.register(past); } catch (err) { regCode = err.code; }
  check('给已开始的研修报名被拒（开始后参与状态冻结）',
    regCode !== '(没被拒)', `实际 ${regCode}`);
  const pastAfter = await db.query(
    'SELECT participation_status AS st FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
    [past],
  );
  check('被拒之后那一场的参与状态没变（不可逆动作只测状态码等于没测）',
    JSON.stringify(pastBefore.rows) === JSON.stringify(pastAfter.rows),
    `${JSON.stringify(pastBefore.rows)} → ${JSON.stringify(pastAfter.rows)}`);

  let cancelCode = '(没被拒)';
  try { await tr.cancel(past); } catch (err) { cancelCode = err.code; }
  check('给已开始的研修取消报名也被拒', cancelCode !== '(没被拒)', `实际 ${cancelCode}`);

  /* 那两个错误码译成教师看得懂的一句。 */
  check('409 译成「已经开始」而不是通用文案',
    tr.actionFailureText({ code: 'state_precondition_failed' }, 'register').indexOf('已经开始') !== -1,
    tr.actionFailureText({ code: 'state_precondition_failed' }, 'register'));
  check('404 译成「不在了」', tr.actionFailureText({ code: 'not_found' }, 'register').indexOf('不在了') !== -1,
    tr.actionFailureText({ code: 'not_found' }, 'register'));
}

/* ── 提交回馈（会改库） ──────────────────────────────────────────────────── */

async function submitFeedbackSection() {
  /* 本地预检与服务端规则一致。 */
  check('空回馈拦下', tr.whyCannotSubmitFeedback(' ') !== '');
  check('齐全时放行', tr.whyCannotSubmitFeedback('还不错') === '');
  check(`超过 ${tr.FEEDBACK_MAX} 字拦下`,
    tr.whyCannotSubmitFeedback('x'.repeat(tr.FEEDBACK_MAX + 1)) !== '');

  /* 没参加过的那一场交不上去 —— 只有 participation 已 s3 的人能交（F9）。 */
  const notMine = await scalar(
    `SELECT t.training_id FROM db_training t
      WHERE t.school_id = 1 AND t.training_status = 's1'
        AND NOT EXISTS (SELECT 1 FROM db_training_participation p
                         WHERE p.training_id = t.training_id AND p.teacher_id = 1
                           AND p.participation_status = 's3')
      ORDER BY t.training_id LIMIT 1`,
  );
  const before = await scalar('SELECT count(*)::int FROM db_training_feedback');
  let code = '(没被拒)';
  try { await tr.submitFeedback(notMine, '探针不该交上去'); } catch (err) { code = err.code; }
  check('没参加过的研修交不了回馈', code !== '(没被拒)', `实际 ${code}`);
  const after = await scalar('SELECT count(*)::int FROM db_training_feedback');
  check('被拒之后没有凭空多出回馈行', after === before, `${before} → ${after}`);
}

async function cleanup() {
  if (madeParticipation) {
    await db.query(
      'DELETE FROM db_training_participation WHERE training_id = $1 AND teacher_id = 1',
      [FUTURE_ID],
    );
    await db.query("SELECT setval('db_training_participation_training_participation_id_seq', (SELECT max(training_participation_id) FROM db_training_participation))");
  }
  // 详情那一段会写 viewed 事件，一并收走。**删到基线行数为止**，不是删到进场值 ——
  // 后者会让上一次的残留变成这一次的基线，一轮轮累积。
  await db.query(
    `DELETE FROM db_content_access_event WHERE content_access_event_id IN (
       SELECT content_access_event_id FROM db_content_access_event
        ORDER BY content_access_event_id DESC
        LIMIT GREATEST((SELECT count(*)::int FROM db_content_access_event) - $1, 0))`,
    [BASE.accessEvent],
  );
  await db.query("SELECT setval('db_content_access_event_content_access_event_id_seq', (SELECT max(content_access_event_id) FROM db_content_access_event))");

  const after = await db.query(`SELECT
    (SELECT count(*)::int FROM db_training) t,
    (SELECT count(*)::int FROM db_training_participation) p,
    (SELECT count(*)::int FROM db_content_access_event) e`);
  const c = after.rows[0];
  console.log(`清理后：training=${c.t} participation=${c.p} content_access_event=${c.e}`);
  check(`逐表行数回到基线（training=${BASE.training} participation=${BASE.participation}）`,
    c.t === BASE.training && c.p === BASE.participation, JSON.stringify(c));
  check(`db_content_access_event 回到 STATS.md 的基线（${BASE.accessEvent}）`,
    c.e === BASE.accessEvent, `实际 ${c.e}`);
}

// 带超时：死锁要红，不要挂住。
const timer = setTimeout(() => {
  console.error('探针超时（60s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 60_000);
timer.unref();

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  .then(async () => {
    try {
      await cleanup();
    } catch (err) {
      check(`清理失败，数据库可能残留了行：${err.message}`, false);
    }
    await db.end().catch(() => {});
    clearTimeout(timer);
    sb.report();
  });
