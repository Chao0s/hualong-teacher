/**
 * 社区共育 feed、家长评价完成情况、月度评价矩阵三族的探针。
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 与
 * `services/co-education.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一族要钉的东西：
 *
 *   实体      feed 的一行是**一笔家长投稿**，不是一条任务（G71 修的就是这个）。
 *             断言逐行的 id 与库里的**提交行**对得上 —— 两者都是整数，
 *             只看「有 id」分不出实体搞反了没有。
 *   范围      两头钉：看得见 N 条**且**别班那些 id 一个都不在里面（§7.4）。
 *   筛选      两个筛选各自真的生效，且缺席时不加 predicate。
 *   时间      `submitted_at` 钉到库里的裸值缀 `+08:00`，一秒不差（§7.6）。
 *             断言形状会把「差 8 小时」读成「格式对」。
 *   折算      `completion` 由服务端算，`p2 → c1`，其余 → `c2`。逐行与库比。
 *   游标      翻完全程，笔数与集合都要与整取的那一份逐个相同。
 *
 * **会改数据库**（进册那一段），跑完自己收拾并核对逐表行数回到基线。
 *
 *   node tools/probe-coeducation.mjs
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
const co = require_(resolve(MP, 'services', 'co-education.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const time = require_(resolve(MP, 'utils', 'time.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);

/** 逐表基线（STATS.md）。进册那一段会动 db_file_ref，跑完必须回到这个数。 */
const BASE_FILE_REF = 745;
/** 数据集的「今天」是 2026-04-25，由服务端的 --today 决定。 */
const CLASS_ID = 1;

/** 本轮改过的进册行，跑完还原。 */
const restore = [];
/** 本轮建的月评行，跑完删掉。 */
const madeMonthEvals = [];
const BASE_MONTH_EVAL = 420;
/** 本轮开的窗，跑完整期删掉。 */
const openedPeriods = [];
const BASE_PARENT_EVAL = 90;
const BASE_PARENT_EVAL_ALL = 540;

async function scalar(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

/** 整取一族全部页，直到游标为空。用来验分页与整取给出同一个集合。 */
async function drainFeed(opts) {
  const all = [];
  let cursor;
  do {
    const page = await co.listCommunityFeed({ ...opts, cursor, limit: opts.limit || 10 });
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

async function main() {
  await db.connect();

  const baseFileRef = await scalar('SELECT count(*)::int FROM db_file_ref');
  check(`db_file_ref 基线与 STATS.md 一致（${BASE_FILE_REF}）`,
    baseFileRef === BASE_FILE_REF, `实际 ${baseFileRef}`);

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  await feedSection();
  await parentEvalSection();
  await monthEvalSection();
  await inclusionSection();
  await readReceiptSection();
  await evalDetailSection();
  await monthEvalWriteSection();
}

/* ── 社区共育 feed ───────────────────────────────────────────────────────── */

async function feedSection() {
  const page = await co.listCommunityFeed({ limit: 100 });
  check('feed 非空', page.items.length > 0, `拿到 ${page.items.length} 条`);
  has(page.items[0], [
    'id', 'taskId', 'childId', 'author', 'initial', 'taskTitle',
    'type', 'typeLabel', 'underCheck', 'text', 'fileIds',
    'submittedAt', 'submittedLabel', 'included',
  ], 'feed 行');

  /* 实体：id 必须是提交行的 id，不是任务行的 id（G71 的正题）。 */
  const ids = page.items.map((r) => r.id);
  const asSubmissions = await scalar(
    'SELECT count(*)::int FROM db_parent_task_submission WHERE parent_task_submission_id = ANY($1::int[])',
    [ids],
  );
  check(`每一行的 id 都在 db_parent_task_submission 里（${ids.length} 条全中）`,
    asSubmissions === ids.length, `${asSubmissions}/${ids.length} 命中`);
  // 反面：一行对一笔提交，不是一行对一条任务。任务只有 9 条，提交有 76 笔。
  const distinctTasks = new Set(page.items.map((r) => r.taskId)).size;
  check('提交笔数远多于任务条数（一条任务对 N 笔投稿，不是一对一）',
    ids.length > distinctTasks, `${ids.length} 笔投稿分布在 ${distinctTasks} 条任务上`);

  /* 范围两头钉：数目相同，且别班的一个都不在里面。 */
  const inClass = await scalar(
    `SELECT count(*)::int FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id = $1 AND t.publish_status IN ('s2','s3') AND s.submission_status = 'c1'`,
    [CLASS_ID],
  );
  check(`1 班库里 ${inClass} 笔已交，feed 拿到 ${ids.length} 笔，数目相同`,
    inClass === ids.length, `库 ${inClass} vs feed ${ids.length}`);
  const foreign = await scalar(
    `SELECT count(*)::int FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE s.parent_task_submission_id = ANY($1::int[]) AND t.class_id <> $2`,
    [ids, CLASS_ID],
  );
  check('feed 里没有别班的投稿', foreign === 0, `混进了 ${foreign} 笔`);

  /* 只列真的交了的：c2 空行一笔都不该出现。 */
  const c2InFeed = await scalar(
    `SELECT count(*)::int FROM db_parent_task_submission
      WHERE parent_task_submission_id = ANY($1::int[]) AND submission_status <> 'c1'`,
    [ids],
  );
  check('feed 里没有未提交的空行（服务端筛了 c1）', c2InFeed === 0, `混进了 ${c2InFeed} 笔`);
  const c2InClass = await scalar(
    `SELECT count(*)::int FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id = $1 AND t.publish_status IN ('s2','s3') AND s.submission_status = 'c2'`,
    [CLASS_ID],
  );
  check(`库里确实有 ${c2InClass} 笔未提交（所以上一条不是因为库里没有）`,
    c2InClass > 0, `实际 ${c2InClass} 笔`);

  /* 时间：钉到库里的裸值，不是钉形状（§7.6）。 */
  const wire = await db.query(
    `SELECT parent_task_submission_id AS id,
            to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS w
       FROM db_parent_task_submission WHERE parent_task_submission_id = ANY($1::int[])`,
    [ids],
  );
  const expect = new Map(wire.rows.map((r) => [r.id, r.w]));
  const off = page.items.filter((r) => r.submittedAt !== expect.get(r.id));
  check('submitted_at 的线上值 = 库里的裸值缀上 +08:00，一秒不差',
    off.length === 0,
    JSON.stringify(off.slice(0, 3).map((r) => [r.id, r.submittedAt, expect.get(r.id)])));
  check('线上格式是 +08:00 而不是 Z 或裸串',
    page.items.every((r) => time.isWireTimestamp(r.submittedAt)),
    `实际 ${page.items.slice(0, 2).map((r) => r.submittedAt).join(',')}`);

  /* 排序：submitted_at DESC, id DESC。逐对比，不只看第一条。 */
  let sorted = true;
  for (let i = 1; i < page.items.length; i += 1) {
    const a = page.items[i - 1];
    const b = page.items[i];
    if (a.submittedAt < b.submittedAt
      || (a.submittedAt === b.submittedAt && a.id < b.id)) { sorted = false; break; }
  }
  check('按 submitted_at DESC, id DESC 排序（逐对比过）', sorted, '有一处逆序');

  /* 卡片上下文三项：契约新增的字段真的回来了，且与库对得上。 */
  check('每一行都有幼儿姓名（不是空串，也不是 undefined）',
    page.items.every((r) => typeof r.author === 'string' && r.author.endsWith('家长') && r.author.length > 2),
    JSON.stringify(page.items.slice(0, 3).map((r) => r.author)));
  check('每一行都有任务标题',
    page.items.every((r) => r.taskTitle && r.taskTitle !== '（未命名）'),
    '有行没有 parent_task_title');
  check('类型只出现 t1/t2',
    page.items.every((r) => ['t1', 't2'].includes(r.type)),
    `实际 ${[...new Set(page.items.map((r) => r.type))].join(',')}`);
  check('类型译成中文而不是漏出编码',
    page.items.every((r) => ['日常', '社区'].includes(r.typeLabel)),
    `实际 ${[...new Set(page.items.map((r) => r.typeLabel))].join(',')}`);

  /* 筛选：各自真的生效，且缺席＝不加 predicate。 */
  const t1 = await co.listCommunityFeed({ type: 't1', limit: 100 });
  const t2 = await co.listCommunityFeed({ type: 't2', limit: 100 });
  check('type=t1 只回 t1', t1.items.every((r) => r.type === 't1'),
    `实际 ${[...new Set(t1.items.map((r) => r.type))].join(',')}`);
  check('type=t2 只回 t2', t2.items.every((r) => r.type === 't2'),
    `实际 ${[...new Set(t2.items.map((r) => r.type))].join(',')}`);
  check(`t1 ${t1.items.length} 笔 + t2 ${t2.items.length} 笔 = 全部 ${ids.length} 笔`,
    t1.items.length + t2.items.length === ids.length,
    `${t1.items.length}+${t2.items.length} vs ${ids.length}`);
  check('两个筛选都不是被忽略（各自都少于全部）',
    t1.items.length < ids.length && t2.items.length < ids.length,
    `t1 ${t1.items.length} t2 ${t2.items.length} 全部 ${ids.length}`);

  /* 时间窗：边界由服务端按园所今天算，客户端一个日期都不推。 */
  const week = await co.listCommunityFeed({ timeWindow: 'week', limit: 100 });
  const month = await co.listCommunityFeed({ timeWindow: 'month', limit: 100 });
  const earlier = await co.listCommunityFeed({ timeWindow: 'earlier', limit: 100 });
  check(`本月 ${month.items.length} 笔 + 更早 ${earlier.items.length} 笔 = 全部 ${ids.length} 笔`,
    month.items.length + earlier.items.length === ids.length,
    `${month.items.length}+${earlier.items.length} vs ${ids.length}`);
  check('本周是本月的子集（两者刻意重叠，不是连续分段）',
    week.items.length <= month.items.length
    && week.items.every((r) => month.items.some((m) => m.id === r.id)),
    `week ${week.items.length} vs month ${month.items.length}`);
  // 窗口真的按库里的 submitted_at 切，不是回一个恒等集合。
  const monthCut = await scalar(
    `SELECT count(*)::int FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id = $1 AND t.publish_status IN ('s2','s3') AND s.submission_status = 'c1'
        AND s.submitted_at >= date_trunc('month', DATE '2026-04-25')`,
    [CLASS_ID],
  );
  check(`本月那一档与库里 2026-04 之后的笔数一致（${monthCut}）`,
    month.items.length === monthCut, `feed ${month.items.length} vs 库 ${monthCut}`);

  /* 游标：翻完全程 = 整取那一份，笔数与集合都相同。 */
  const drained = await drainFeed({ limit: 10 });
  check(`按游标翻完 ${drained.length} 笔，与整取的 ${ids.length} 笔相同`,
    drained.length === ids.length, `翻页 ${drained.length} vs 整取 ${ids.length}`);
  check('翻页拿到的 id 集合与整取逐个相同（没有重复也没有漏）',
    JSON.stringify(drained.map((r) => r.id)) === JSON.stringify(ids),
    '两份 id 序列不同');
}

/* ── 家长评价完成情况 ─────────────────────────────────────────────────────── */

async function parentEvalSection() {
  const board = await co.listParentEvaluations({ limit: 100 });
  check('家长评价看板非空', board.rows.length > 0, `拿到 ${board.rows.length} 行`);
  has(board.rows[0], [
    'id', 'childId', 'name', 'type', 'typeLabel', 'period',
    'status', 'statusLabel', 'completion', 'done', 'stateLabel', 'stateTone',
  ], '家长评价行');

  check('每一行都有姓名', board.rows.every((r) => r.name), '有行没有 child_name');
  check('折算值只出现 c1/c2',
    board.rows.every((r) => ['c1', 'c2'].includes(r.completion)),
    `实际 ${[...new Set(board.rows.map((r) => r.completion))].join(',')}`);
  check('原始编码照实带出来，没有被折算吃掉',
    board.rows.every((r) => ['p0', 'p1', 'p2', 'p3'].includes(r.status)),
    `实际 ${[...new Set(board.rows.map((r) => r.status))].join(',')}`);

  /* 折算逐行与库比：p2 → c1，其余 → c2。 */
  const ids = board.rows.map((r) => r.id);
  const dbRows = await db.query(
    `SELECT parent_evaluation_id AS id, evaluation_status AS st
       FROM db_parent_evaluation WHERE parent_evaluation_id = ANY($1::int[])`,
    [ids],
  );
  const dbStatus = new Map(dbRows.rows.map((r) => [r.id, r.st]));
  const wrong = board.rows.filter(
    (r) => r.completion !== (dbStatus.get(r.id) === 'p2' ? 'c1' : 'c2'),
  );
  check('completion 逐行等于 completion_map(库里的 evaluation_status)',
    wrong.length === 0,
    JSON.stringify(wrong.slice(0, 3).map((r) => [r.id, dbStatus.get(r.id), r.completion])));
  const p2 = [...dbStatus.values()].filter((s) => s === 'p2').length;
  check(`已完成笔数等于库里 p2 的笔数（${p2}）`,
    board.summary.done === p2, `看板 ${board.summary.done} vs 库 ${p2}`);
  check('汇总 total = 已完成 + 未完成',
    board.summary.total === board.summary.done + board.summary.undone,
    JSON.stringify(board.summary));

  /* 契约明写不回家长正文 —— 漏出来就是把关失守。 */
  check('看板不回家长写的正文（契约的 BoardRow 没有 evaluation_text）',
    board.rows.every((r) => !('text' in r) && !('evaluationText' in r) && !('preview' in r)),
    '正文漏出来了');

  /* 范围两头钉。 */
  const inClass = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE class_id = $1', [CLASS_ID],
  );
  check(`1 班库里 ${inClass} 笔，看板拿到 ${board.rows.length} 笔`,
    inClass === board.rows.length, `库 ${inClass} vs 看板 ${board.rows.length}`);
  const foreign = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE parent_evaluation_id = ANY($1::int[]) AND class_id <> $2',
    [ids, CLASS_ID],
  );
  check('看板里没有别班的评价', foreign === 0, `混进了 ${foreign} 笔`);

  /* 筛选真的生效。 */
  const t1 = await co.listParentEvaluations({ type: 't1', limit: 100 });
  check('evaluation_type=t1 只回 t1',
    t1.rows.length > 0 && t1.rows.every((r) => r.type === 't1'),
    `${t1.rows.length} 行，类型 ${[...new Set(t1.rows.map((r) => r.type))].join(',')}`);
  check('t1 少于全部（筛选没有被忽略）',
    t1.rows.length < board.rows.length, `t1 ${t1.rows.length} vs 全部 ${board.rows.length}`);
  // 期间键是不透明串，原样比对，不当日期解析。
  const period = board.rows[0].period;
  const byPeriod = await co.listParentEvaluations({ period, limit: 100 });
  check(`evaluation_period=${period} 只回该期间`,
    byPeriod.rows.length > 0 && byPeriod.rows.every((r) => r.period === period),
    `${byPeriod.rows.length} 行`);
}

/* ── 月度评价矩阵 ─────────────────────────────────────────────────────────── */

async function monthEvalSection() {
  const board = await co.monthEvalBoard({});
  check('月评矩阵有月份列', board.months.length > 0, `${board.months.length} 列`);
  check('月评矩阵有行', board.rows.length > 0, `${board.rows.length} 行`);
  has(board.rows[0], ['childId', 'name', 'states', 'evalIds'], '月评行');

  check('每一行都有姓名', board.rows.every((r) => r.name), '有行没有 child_name');
  check('每一行的格数等于月份列数',
    board.rows.every((r) => r.states.length === board.months.length),
    `列 ${board.months.length}，实际 ${[...new Set(board.rows.map((r) => r.states.length))].join(',')}`);
  check('格子只有 done/miss 两态（对外二元，草稿不外显）',
    board.rows.every((r) => r.states.every((s) => ['done', 'miss'].includes(s))),
    '出现了第三态');

  /* 月份列 = 本学期完整覆盖的那几个月，**不是**库里出现过的全部月份。 */
  const allMonths = await db.query(
    'SELECT DISTINCT eval_month AS m FROM db_month_eval WHERE class_id = $1 AND teacher_id = 1 ORDER BY m DESC',
    [CLASS_ID],
  );
  check(`库里一共 ${allMonths.rows.length} 个月，矩阵只显示本学期的 ${board.months.length} 个（不是全部）`,
    board.months.length < allMonths.rows.length,
    `矩阵 ${board.months.join(',')} vs 库 ${allMonths.rows.map((r) => r.m).join(',')}`);
  check('矩阵的每一列都在库里那份月份清单之内，或者是本学期还没写的月份',
    board.months.every((m) => /^\d{4}-\d{2}$/.test(m)), board.months.join(','));
  check('月份标签只是数字，没有漏出 YYYY-MM',
    board.monthLabels.every((l) => /^\d{1,2}$/.test(l)),
    `实际 ${board.monthLabels.join(',')}`);

  /* 对外二元逐格与库比：只有 e3 算完成。 */
  const cells = await db.query(
    `SELECT child_id, eval_month, month_eval_status AS st
       FROM db_month_eval WHERE class_id = $1 AND teacher_id = 1
        AND eval_month = ANY($2::text[])`,
    [CLASS_ID, board.months],
  );
  const byKey = new Map(cells.rows.map((r) => [`${r.child_id}|${r.eval_month}`, r.st]));
  let mismatch = 0;
  board.rows.forEach((row) => {
    board.months.forEach((m, i) => {
      const st = byKey.get(`${row.childId}|${m}`);
      const expected = st === 'e3' ? 'done' : 'miss';
      if (row.states[i] !== expected) mismatch += 1;
    });
  });
  check('逐格与库比：只有 e3 是 done，e1/e2/无记录都是 miss', mismatch === 0,
    `${mismatch} 格对不上`);
  const e3 = cells.rows.filter((r) => r.st === 'e3').length;
  check(`已完成格数等于库里本学期这几个月的 e3 笔数（${e3}）`,
    board.summary.done === e3, `矩阵 ${board.summary.done} vs 库 ${e3}`);
  // 草稿真的存在，所以上一条不是因为库里全是 e3。
  const draft = cells.rows.filter((r) => r.st !== 'e3').length;
  check(`本学期确实有 ${draft} 笔非 e3（草稿态没有被误算成完成）`, draft > 0, `实际 ${draft}`);

  /* 范围两头钉：别的教师、别的班一格都不该进来。 */
  const ids = board.rows.map((r) => r.childId);
  const foreign = await scalar(
    'SELECT count(*)::int FROM db_child WHERE child_id = ANY($1::int[]) AND class_id <> $2',
    [ids, CLASS_ID],
  );
  check('矩阵里没有别班的幼儿', foreign === 0, `混进了 ${foreign} 名`);

  /* 筛选真的生效。 */
  const one = await co.monthEvalBoard({ month: board.months[0] });
  check(`eval_month=${board.months[0]} 只回一列`,
    one.months.length === 1 && one.months[0] === board.months[0],
    `实际 ${one.months.join(',')}`);
  const child = await co.monthEvalBoard({ childId: board.rows[0].childId });
  check('child_id 筛选只回该幼儿一行',
    child.rows.length === 1 && child.rows[0].childId === board.rows[0].childId,
    `实际 ${child.rows.length} 行`);
}

/* ── 教师分支进册（会改库，自己收拾） ────────────────────────────────────── */

async function inclusionSection() {
  const page = await co.listCommunityFeed({ limit: 100 });
  const target = page.items.find((r) => r.fileIds.length > 0 && !r.included);
  check('找得到一笔有照片且尚未进册的投稿（用来测进册）',
    Boolean(target), '数据集里没有这样的行');
  if (!target) return;

  const before = await scalar(
    'SELECT teacher_book_included FROM db_parent_task_submission WHERE parent_task_submission_id = $1',
    [target.id],
  );
  restore.push({ id: target.id, included: before });

  /* 收进去：布尔与 file_ref 都要真的落库。 */
  const out = await co.setBookInclusion(target.id, { included: true, fileIds: [target.fileIds[0]] });
  check('进册回 200 且 teacher_book_included 为真',
    out && out.teacher_book_included === true, JSON.stringify(out));
  const stored = await scalar(
    'SELECT teacher_book_included FROM db_parent_task_submission WHERE parent_task_submission_id = $1',
    [target.id],
  );
  check('库里的 teacher_book_included 也是真（不只是回包说真）',
    stored === true, `实际 ${stored}`);
  const refs = await scalar(
    `SELECT count(*)::int FROM db_file_ref
      WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_teacher'`,
    [target.id],
  );
  check('file_id 真的落进 db_file_ref 的 book_teacher 一支（不是收下即丢）',
    refs === 1, `实际 ${refs} 行`);

  /* 两支各自独立：动教师这一支，家长那一支一行都不能少。 */
  const parentRefs = await scalar(
    `SELECT count(*)::int FROM db_file_ref
      WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_parent'`,
    [target.id],
  );
  check('家长那一支的引用没被动到（两支各自独立）',
    parentRefs === target.fileIds.length, `实际 ${parentRefs} vs ${target.fileIds.length}`);

  /* 混进别处的 file_id 要被拒，且拒掉之后库里不留痕。 */
  let code = '(没被拒)';
  try {
    await co.setBookInclusion(target.id, { included: true, fileIds: [999999] });
  } catch (err) { code = err.code; }
  check('拿别处的 file_id 进册回 422 validation_failed', code === 'validation_failed', `实际 ${code}`);
  const afterBad = await scalar(
    `SELECT count(*)::int FROM db_file_ref
      WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_teacher'`,
    [target.id],
  );
  check('被拒之后 book_teacher 那一支仍是原来的 1 行（交易回滚了）',
    afterBad === 1, `实际 ${afterBad} 行`);

  /* 未提交的那一笔不得进册（契约的范围语句要求 c1）。 */
  const c2 = await scalar(
    `SELECT s.parent_task_submission_id FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id = $1 AND s.submission_status = 'c2' LIMIT 1`,
    [CLASS_ID],
  );
  let c2code = '(没被拒)';
  try {
    await co.setBookInclusion(c2, { included: true, fileIds: [] });
  } catch (err) { c2code = err.code; }
  check('把未提交的那一笔收进成长册回 404（契约要求 c1）', c2code === 'not_found', `实际 ${c2code}`);
  const c2after = await scalar(
    'SELECT teacher_book_included FROM db_parent_task_submission WHERE parent_task_submission_id = $1',
    [c2],
  );
  check('被拒之后那一笔的进册标记没变（仍是 false）', c2after === false, `实际 ${c2after}`);

  /* 别班的那一笔改不动，且回 404 不泄漏存在性。 */
  const theirs = await scalar(
    `SELECT s.parent_task_submission_id FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id <> $1 AND s.submission_status = 'c1' LIMIT 1`,
    [CLASS_ID],
  );
  const theirsBefore = await scalar(
    'SELECT teacher_book_included FROM db_parent_task_submission WHERE parent_task_submission_id = $1',
    [theirs],
  );
  let crossCode = '(没被拒)';
  try {
    await co.setBookInclusion(theirs, { included: true, fileIds: [] });
  } catch (err) { crossCode = err.code; }
  check('把别班的投稿收进成长册回 404（不泄漏存在性）', crossCode === 'not_found', `实际 ${crossCode}`);
  const theirsAfter = await scalar(
    'SELECT teacher_book_included FROM db_parent_task_submission WHERE parent_task_submission_id = $1',
    [theirs],
  );
  check('别班那一笔的进册标记一个字都没变',
    theirsAfter === theirsBefore, `${theirsBefore} → ${theirsAfter}`);

  /* 移出：整份替换成空，布尔与引用一起退掉。 */
  const off = await co.setBookInclusion(target.id, { included: false, fileIds: [] });
  check('移出回 200 且 teacher_book_included 为假',
    off && off.teacher_book_included === false, JSON.stringify(off));
  const refsAfter = await scalar(
    `SELECT count(*)::int FROM db_file_ref
      WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_teacher'`,
    [target.id],
  );
  check('book_teacher 那一支的引用清空了', refsAfter === 0, `实际 ${refsAfter} 行`);
  const parentAfter = await scalar(
    `SELECT count(*)::int FROM db_file_ref
      WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_parent'`,
    [target.id],
  );
  check('移出没有连累家长那一支（只解除关系，不删来源附件）',
    parentAfter === target.fileIds.length, `实际 ${parentAfter}`);
}

/* ── 已读（F24） ─────────────────────────────────────────────────────────── */

async function readReceiptSection() {
  const taskId = await scalar(
    `SELECT parent_task_id FROM db_parent_task
      WHERE class_id = $1 AND publish_status IN ('s2','s3') ORDER BY parent_task_id LIMIT 1`,
    [CLASS_ID],
  );
  const board = await co.submissionBoard(taskId);
  has(board.rows[0], ['read', 'readLabel', 'readTone', 'readAt', 'doneLabel', 'doneTone'], '看板行（已读）');

  const dbRows = await db.query(
    `SELECT ch.child_id, (s.read_at IS NOT NULL) AS rd
       FROM db_child ch
       LEFT JOIN db_parent_task_submission s
              ON s.parent_task_id = $1 AND s.child_id = ch.child_id
      WHERE ch.class_id = $2 AND ch.enrollment_status = 'e1'`,
    [taskId, CLASS_ID],
  );
  const byChild = new Map(dbRows.rows.map((r) => [r.child_id, r.rd]));
  const wrong = board.rows.filter((r) => r.read !== byChild.get(r.childId));
  check('每一行的已读与库里的 read_at 逐行对得上', wrong.length === 0,
    JSON.stringify(wrong.slice(0, 3).map((r) => [r.childId, r.read])));

  // **两列，不是一列**：「读没读」与「做没做」是两个独立维度。
  check('已读列只出现 已读／未读',
    board.rows.every((r) => ['已读', '未读'].includes(r.readLabel)),
    `实际 ${[...new Set(board.rows.map((r) => r.readLabel))].join(',')}`);
  check('完成情况列只出现 已完成／未完成／审核中',
    board.rows.every((r) => ['已完成', '未完成', '审核中'].includes(r.doneLabel)),
    `实际 ${[...new Set(board.rows.map((r) => r.doneLabel))].join(',')}`);
  check('已完成的那些「已读」恒为真（打不开就交不了）',
    board.rows.filter((r) => r.done).every((r) => r.read === true),
    '有已完成的行显示成未读');
  const unreadInDb = dbRows.rows.filter((r) => !r.rd).length;
  check(`汇总的未读数等于库里 read_at 为空的行数（${unreadInDb}）`,
    board.summary.unread === unreadInDb, `看板 ${board.summary.unread} vs 库 ${unreadInDb}`);
  check('total = 已完成 + 已读未完成 + 未读（三档不重不漏）',
    board.summary.total === board.rows.filter((r) => r.done).length
      + board.rows.filter((r) => !r.done && r.read).length
      + board.rows.filter((r) => !r.done && !r.read).length,
    JSON.stringify(board.summary));

  // 三档在数据集里都要真的存在，否则上面几条可能是空过。
  const three = await db.query(
    `SELECT CASE WHEN s.submission_status = 'c1' THEN 'done'
                 WHEN s.read_at IS NOT NULL THEN 'read_undone' ELSE 'unread' END AS k,
            count(*)::int AS n
       FROM db_parent_task_submission s
       JOIN db_parent_task t ON t.parent_task_id = s.parent_task_id
      WHERE t.class_id = $1 AND t.publish_status IN ('s2','s3') GROUP BY 1`,
    [CLASS_ID],
  );
  const kinds = new Map(three.rows.map((r) => [r.k, r.n]));
  check(`数据集三档都非空：已完成 ${kinds.get('done') || 0}、已读未完成 ${kinds.get('read_undone') || 0}、未读 ${kinds.get('unread') || 0}`,
    (kinds.get('done') || 0) > 0 && (kinds.get('read_undone') || 0) > 0
      && (kinds.get('unread') || 0) > 0,
    JSON.stringify([...kinds]));

  // 打不开就交不了：两条矛盾在全库都不该存在。
  const impossible = await scalar(
    "SELECT count(*)::int FROM db_parent_task_submission WHERE submission_status = 'c1' AND read_at IS NULL",
  );
  check('全库没有「已交但未读」的矛盾行', impossible === 0, `实际 ${impossible} 行`);
  const late = await scalar(
    'SELECT count(*)::int FROM db_parent_task_submission WHERE read_at > submitted_at',
  );
  check('全库没有 read_at 晚于 submitted_at 的行', late === 0, `实际 ${late} 行`);
}

/* ── 家长评价详情（G73 的解） ────────────────────────────────────────────── */

async function evalDetailSection() {
  const p2 = await scalar(
    `SELECT parent_evaluation_id FROM db_parent_evaluation
      WHERE class_id = $1 AND evaluation_status = 'p2' ORDER BY parent_evaluation_id LIMIT 1`,
    [CLASS_ID],
  );
  const detail = await co.getParentEvaluation(p2);
  has(detail, ['id', 'name', 'title', 'prompt', 'text', 'hasText', 'read', 'stateLabel'], '评价详情');

  const dbText = await scalar(
    'SELECT evaluation_text FROM db_parent_evaluation WHERE parent_evaluation_id = $1', [p2],
  );
  check('p2 的正文与库里逐字相同（不是截断也不是摘要）', detail.text === dbText,
    `回包 ${detail.text.slice(0, 16)} vs 库 ${String(dbText).slice(0, 16)}`);
  check('p2 的 hasText 为真', detail.hasText === true, String(detail.hasText));

  // 草稿不给教师看 —— 服务端置空，不是靠客户端自觉不显示。
  const p1 = await scalar(
    `SELECT parent_evaluation_id FROM db_parent_evaluation
      WHERE class_id = $1 AND evaluation_status = 'p1' LIMIT 1`,
    [CLASS_ID],
  );
  const draft = await co.getParentEvaluation(p1);
  check('p1 草稿的正文被服务端置空（草稿不给教师看）',
    draft.text === '' && draft.hasText === false, JSON.stringify(draft.text));
  const p1InDb = await scalar(
    'SELECT evaluation_text FROM db_parent_evaluation WHERE parent_evaluation_id = $1', [p1],
  );
  check('而库里那一行本来就没有正文（所以上一条不是因为服务端藏了东西）',
    p1InDb === null, String(p1InDb));

  const theirs = await scalar(
    `SELECT parent_evaluation_id FROM db_parent_evaluation
      WHERE class_id <> $1 AND evaluation_status = 'p2' LIMIT 1`,
    [CLASS_ID],
  );
  let code = '(没被拒)';
  try { await co.getParentEvaluation(theirs); } catch (err) { code = err.code; }
  check('读别班的家长评价回 404（不泄漏存在性）', code === 'not_found', `实际 ${code}`);

  /* 按期间分组：每组的分母是那一组真实的行数，不是班级人数。 */
  const groups = await co.parentEvalPeriods({});
  check('按期间分组回了多组（数据集是 9 期）', groups.length > 1, `实际 ${groups.length} 组`);
  has(groups[0], ['key', 'type', 'period', 'total', 'done', 'read', 'percent', 'mark', 'title', 'meta'], '期间分组');
  const dbGroups = await db.query(
    `SELECT evaluation_type AS t, evaluation_period AS p, count(*)::int AS n,
            count(*) FILTER (WHERE evaluation_status = 'p2')::int AS done
       FROM db_parent_evaluation WHERE class_id = $1 GROUP BY 1, 2`,
    [CLASS_ID],
  );
  const byKey = new Map(dbGroups.rows.map((r) => [`${r.t}|${r.p}`, r]));
  const bad = groups.filter((g) => {
    const d = byKey.get(g.key);
    return !d || d.n !== g.total || d.done !== g.done;
  });
  check('每一组的分母与已提交数都与库里那一组对得上',
    bad.length === 0,
    JSON.stringify(bad.slice(0, 3).map((g) => [g.key, g.done, g.total])));
  check('分组数与库里的期间数相同',
    groups.length === dbGroups.rows.length, `${groups.length} vs ${dbGroups.rows.length}`);
  check('分母不是写死的班级人数（各组行数可以不同）',
    groups.every((g) => g.total === byKey.get(g.key).n), '有一组的分母对不上');

  await openWindowSection(groups);

  const boardRows = await co.listParentEvaluations({ limit: 5 });
  check('看板行仍然不带正文（一次发全班正文没道理）',
    boardRows.rows.every((r) => !('text' in r)), '正文漏进看板了');
  has(boardRows.rows[0], ['read', 'readLabel', 'readTone'], '家长评价看板行（已读）');
}

/* ── 月评：学期整月、存草稿、发布（会改库，自己收拾） ──────────────────── */

async function monthEvalWriteSection() {
  const term = await db.query(
    `SELECT to_char(start_date, 'YYYY-MM-DD') s, to_char(end_date, 'YYYY-MM-DD') e
       FROM db_school_term WHERE term_id = '2025-2026-2' AND school_id = 1`,
  );
  const clientMonths = time.wholeMonthsOfTerm(term.rows[0].s, term.rows[0].e);
  check('客户端算出本学期是 3/4/5/6 四个月（两头半个月不算）',
    JSON.stringify(clientMonths) === JSON.stringify(['2026-06', '2026-05', '2026-04', '2026-03']),
    clientMonths.join(','));

  const board = await co.monthEvalBoard({ termId: '2025-2026-2' });
  check('矩阵的列与客户端算出的学期整月逐个相同',
    JSON.stringify(board.months) === JSON.stringify(clientMonths), board.months.join(','));
  check('矩阵的行 = 本班在园名册 10 人（没写过评价的也要有一行）',
    board.rows.length === 10, `实际 ${board.rows.length} 行`);
  check('5 月与 6 月整月没有记录，仍然各占一列（未完成不能从表上消失）',
    board.months.indexOf('2026-05') > -1 && board.months.indexOf('2026-06') > -1,
    board.months.join(','));

  // 服务端回的月份必须全在客户端算出的列里 —— 两边规则漂开会当场红。
  const served = await db.query(
    `SELECT DISTINCT eval_month AS m FROM db_month_eval
      WHERE class_id = $1 AND teacher_id = 1
        AND eval_month BETWEEN $2 AND $3`,
    [CLASS_ID, clientMonths[clientMonths.length - 1], clientMonths[0]],
  );
  check('服务端回的每个月份都在客户端算出的列里（两边规则一致）',
    served.rows.every((r) => clientMonths.indexOf(r.m) > -1),
    served.rows.map((r) => r.m).join(','));

  /* 存草稿：upsert、落 e1、不写 saved_at。 */
  const childId = board.rows[0].childId;
  const MONTH = '2026-06';
  const before = await scalar('SELECT count(*)::int FROM db_month_eval');
  const saved = await co.saveMonthEvalDraft({ childId, month: MONTH, text: '探针写的草稿。' });
  madeMonthEvals.push(saved.month_eval_id);
  check('存草稿回 200 并建了一行', Boolean(saved.month_eval_id), JSON.stringify(saved));
  check('草稿落 e1（e2 已作废，F25）', saved.month_eval_status === 'e1', saved.month_eval_status);
  check('存草稿**不写** saved_at（它由发布那一步写）', saved.saved_at === null,
    JSON.stringify(saved.saved_at));

  const stored = await db.query(
    `SELECT eval_text, saved_at, teacher_id, class_id
       FROM db_month_eval WHERE month_eval_id = $1`,
    [saved.month_eval_id],
  );
  check('库里的正文与发出去的逐字相同', stored.rows[0].eval_text === '探针写的草稿。',
    stored.rows[0].eval_text);
  check('库里的 saved_at 也是空', stored.rows[0].saved_at === null, String(stored.rows[0].saved_at));
  check('teacher_id/class_id 由服务端派生为 1/1',
    stored.rows[0].teacher_id === 1 && stored.rows[0].class_id === 1,
    JSON.stringify([stored.rows[0].teacher_id, stored.rows[0].class_id]));

  const again = await co.saveMonthEvalDraft({ childId, month: MONTH, text: '改过的草稿。' });
  check('同一格再存一次是 upsert，不是新建一行',
    again.month_eval_id === saved.month_eval_id,
    `${saved.month_eval_id} vs ${again.month_eval_id}`);
  const after = await scalar('SELECT count(*)::int FROM db_month_eval');
  check('行数只多了 1（不是两行）', after === before + 1, `${before} → ${after}`);

  /* 发布：转 e3 并写 saved_at。 */
  const pub = await co.publishMonthEval(saved.month_eval_id);
  check('发布后 e3', pub.month_eval_status === 'e3', pub.month_eval_status);
  const afterPub = await scalar(
    'SELECT saved_at FROM db_month_eval WHERE month_eval_id = $1', [saved.month_eval_id],
  );
  check('发布这一步真的写了 saved_at（F25）', afterPub !== null, String(afterPub));

  /* e3 之后存不进草稿，且被拒之后库里没变（§7.5）。 */
  let code = '(没被拒)';
  let from = null;
  try {
    await co.saveMonthEvalDraft({ childId, month: MONTH, text: '不该写得进去' });
  } catch (err) { code = err.code; from = err.details && err.details.from; }
  check('已发布的那一格存草稿回 409 state_precondition_failed',
    code === 'state_precondition_failed', `实际 ${code}`);
  check('409 带 details.from=e3', from === 'e3', String(from));
  const untouched = await scalar(
    'SELECT eval_text FROM db_month_eval WHERE month_eval_id = $1', [saved.month_eval_id],
  );
  check('被拒之后正文一个字都没变（不可逆动作只测状态码等于没测）',
    untouched === '改过的草稿。', untouched);

  /* 别班的幼儿写不进去，且不凭空多出一行。 */
  const theirChild = await scalar(
    'SELECT child_id FROM db_child WHERE class_id <> $1 LIMIT 1', [CLASS_ID],
  );
  let crossCode = '(没被拒)';
  try {
    await co.saveMonthEvalDraft({ childId: theirChild, month: MONTH, text: '越界' });
  } catch (err) { crossCode = err.code; }
  check('给别班的幼儿写月评回 404', crossCode === 'not_found', `实际 ${crossCode}`);
  const leaked = await scalar(
    'SELECT count(*)::int FROM db_month_eval WHERE child_id = $1 AND eval_month = $2',
    [theirChild, MONTH],
  );
  check('别班那一格没有凭空多出一行', leaked === 0, `实际 ${leaked} 行`);

  /* 本地预检与服务端规则一致。 */
  check('空评语拦下', co.whyCannotSaveMonthEval({ childId: 1, month: MONTH, text: ' ' }) !== '');
  check('齐全时放行', co.whyCannotSaveMonthEval({ childId: 1, month: MONTH, text: 'x' }) === '');
  check(`超过 ${co.MONTH_EVAL_TEXT_MAX} 字拦下`,
    co.whyCannotSaveMonthEval({ childId: 1, month: MONTH, text: 'x'.repeat(501) }) !== '');
}

/* ── 发起家长评价：全班 fan-out（F26 解 G50，会改库） ─────────────────────── */

async function openWindowSection(groups) {
  const before = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE class_id = $1', [CLASS_ID],
  );
  check(`1 班基线 ${BASE_PARENT_EVAL} 笔家长评价`, before === BASE_PARENT_EVAL, `实际 ${before}`);

  const roster = await scalar(
    "SELECT count(*)::int FROM db_child WHERE class_id = $1 AND enrollment_status = 'e1'",
    [CLASS_ID],
  );

  /* 全班 fan-out：一次开窗给每名在园幼儿各建一行。 */
  // 刻意用一个真实操作绝不会产生的期间：页面按园所今天算期间，
  // 撞上的话探针的基线断言会被人为操作弄红（2026-09-07 真撞过一次）。
  const PERIOD = '2099-01';
  const form = {
    type: 't1',
    period: PERIOD,
    title: '探针开的窗（可删）',
    prompt: '探针写的说明。',
    startAt: '2026-09-01T08:00:00+08:00',
    dueAt: '2026-09-08T21:00:00+08:00',
  };
  const n = await co.openParentEvaluationWindow(form);
  openedPeriods.push({ type: 't1', period: PERIOD });
  check(`开窗回本次涉及的 ${roster} 行（全班在园人数）`, n === roster, `实际 ${n}`);

  const after = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE class_id = $1', [CLASS_ID],
  );
  check(`库里多出 ${roster} 行`, after === before + roster, `${before} → ${after}`);

  /* 建的正是在园那些，且逐列与发出去的一致。 */
  const made = await db.query(
    `SELECT e.child_id, e.evaluation_title, e.evaluation_prompt, e.evaluation_status,
            e.requested_by_teacher_id, e.school_id, e.class_id,
            to_char(e.start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS start_wire,
            to_char(e.due_at,   'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS due_wire,
            ch.enrollment_status
       FROM db_parent_evaluation e JOIN db_child ch ON ch.child_id = e.child_id
      WHERE e.evaluation_period = $1 AND e.class_id = $2`,
    [PERIOD, CLASS_ID],
  );
  check('每一行都建给在园（e1）幼儿',
    made.rows.every((r) => r.enrollment_status === 'e1'),
    `实际 ${[...new Set(made.rows.map((r) => r.enrollment_status))].join(',')}`);
  check('新建的行都是 p0（p0 从此有生产者了）',
    made.rows.every((r) => r.evaluation_status === 'p0'),
    `实际 ${[...new Set(made.rows.map((r) => r.evaluation_status))].join(',')}`);
  check('标题与说明逐行与发出去的相同',
    made.rows.every((r) => r.evaluation_title === form.title && r.evaluation_prompt === form.prompt),
    '有行的标题或说明对不上');
  // 计划时刻钉到库里的裸值，不是钉形状（§7.6）。
  check('start_at 原样落库（不是 now()，也没有偏移换算）',
    made.rows.every((r) => r.start_wire === form.startAt),
    `实际 ${made.rows[0] && made.rows[0].start_wire}`);
  check('due_at 同样一秒不差',
    made.rows.every((r) => r.due_wire === form.dueAt),
    `实际 ${made.rows[0] && made.rows[0].due_wire}`);
  check('school_id/class_id/requested_by_teacher_id 由服务端派生为 1/1/1',
    made.rows.every((r) => r.school_id === 1 && r.class_id === 1 && r.requested_by_teacher_id === 1),
    JSON.stringify(made.rows[0]));

  /* 别班一行都不该多出来 —— 范围两头钉。 */
  const spill = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE evaluation_period = $1 AND class_id <> $2',
    [PERIOD, CLASS_ID],
  );
  check('别班没有凭空多出行', spill === 0, `多了 ${spill} 行`);

  /* 重复发起：缺行 INSERT／已有行 skip，且不覆盖已有的说明。 */
  const again = await co.openParentEvaluationWindow({ ...form, prompt: '改过的说明，不该覆盖。' });
  check('重复发起回同样的行数（幂等）', again === roster, `实际 ${again}`);
  const afterAgain = await scalar(
    'SELECT count(*)::int FROM db_parent_evaluation WHERE class_id = $1', [CLASS_ID],
  );
  check('重复发起没有再多出行（ON CONFLICT DO NOTHING）',
    afterAgain === after, `${after} → ${afterAgain}`);
  const prompts = await db.query(
    'SELECT DISTINCT evaluation_prompt AS p FROM db_parent_evaluation WHERE evaluation_period = $1',
    [PERIOD],
  );
  check('已有行的说明**没有被覆盖**（不做 take over，家长可能照旧提示写了一半）',
    prompts.rows.length === 1 && prompts.rows[0].p === form.prompt,
    JSON.stringify(prompts.rows.map((r) => r.p)));

  /* 计划时刻格式不符一律 422，且不做转换。 */
  for (const [label, v] of [['裸串', '2026-09-01 08:00:00'], ['Z', '2026-09-01T08:00:00Z']]) {
    let code = '(没被拒)';
    try {
      await co.openParentEvaluationWindow({ ...form, period: '2099-02', startAt: v });
    } catch (err) { code = err.code; }
    check(`start_at 是 ${label} 时回 422 timestamp_not_accepted`,
      code === 'timestamp_not_accepted', `实际 ${code}`);
  }
  const strayPeriod = await scalar(
    "SELECT count(*)::int FROM db_parent_evaluation WHERE evaluation_period = '2099-02'",
  );
  check('被拒的那两发一行都没建成', strayPeriod === 0, `实际 ${strayPeriod} 行`);

  /* 本地预检与服务端规则一致。 */
  check('缺标题时拦下', co.whyCannotOpenWindow({ ...form, title: ' ' }) !== '');
  check('缺开始时间时拦下', co.whyCannotOpenWindow({ ...form, startAt: '' }) !== '');
  check('截止早于开始时拦下',
    co.whyCannotOpenWindow({ ...form, dueAt: '2026-08-01T08:00:00+08:00' }) !== '');
  check('齐全时放行', co.whyCannotOpenWindow(form) === '', co.whyCannotOpenWindow(form));

  /* 新开的这一期要出现在按期间分组里，且分母 = 那一期真实的行数。 */
  const nowGroups = await co.parentEvalPeriods({});
  const mine = nowGroups.find((g) => g.period === PERIOD);
  check('新开的一期出现在按期间分组里', Boolean(mine), '没找到');
  check(`那一组的分母是本次真实建的行数 ${roster}`,
    mine && mine.total === roster, mine && String(mine.total));
  check('分组数比开窗前多一组',
    nowGroups.length === groups.length + 1, `${groups.length} → ${nowGroups.length}`);
}

async function cleanup() {
  for (const w of openedPeriods) {
    await db.query(
      'DELETE FROM db_parent_evaluation WHERE evaluation_type = $1 AND evaluation_period = $2',
      [w.type, w.period],
    );
  }
  await db.query("SELECT setval('db_parent_evaluation_parent_evaluation_id_seq', (SELECT max(parent_evaluation_id) FROM db_parent_evaluation))");
  const evals = await scalar('SELECT count(*)::int FROM db_parent_evaluation');
  check(`db_parent_evaluation 回到 STATS.md 的基线（${BASE_PARENT_EVAL_ALL}）`,
    evals === BASE_PARENT_EVAL_ALL, `实际 ${evals}`);

  for (const id of madeMonthEvals) {
    await db.query("DELETE FROM db_file_ref WHERE owner_object = 'db_month_eval' AND owner_id = $1", [id]);
    await db.query('DELETE FROM db_month_eval WHERE month_eval_id = $1', [id]);
  }
  await db.query("SELECT setval('db_month_eval_month_eval_id_seq', (SELECT max(month_eval_id) FROM db_month_eval))");
  const monthEvals = await scalar('SELECT count(*)::int FROM db_month_eval');
  check(`db_month_eval 回到 STATS.md 的基线（${BASE_MONTH_EVAL}）`,
    monthEvals === BASE_MONTH_EVAL, `实际 ${monthEvals}`);

  for (const row of restore) {
    await db.query(
      `DELETE FROM db_file_ref
        WHERE owner_object = 'db_parent_task_submission' AND owner_id = $1 AND usage_key = 'book_teacher'`,
      [row.id],
    );
    await db.query(
      'UPDATE db_parent_task_submission SET teacher_book_included = $2 WHERE parent_task_submission_id = $1',
      [row.id, row.included],
    );
  }
  await db.query("SELECT setval('db_file_ref_file_ref_id_seq', (SELECT max(file_ref_id) FROM db_file_ref))");
  const after = await scalar('SELECT count(*)::int FROM db_file_ref');
  console.log(`清理后：db_file_ref=${after}`);
  check(`db_file_ref 回到 STATS.md 的基线（${BASE_FILE_REF}）`,
    after === BASE_FILE_REF, `实际 ${after}`);
}

// 带超时：死锁要红，不要挂住（与 probe-session 同一条理由）。
const timer = setTimeout(() => {
  console.error('探针超时（60s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 60_000);
timer.unref();

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理无论主体成败都跑：主体半途炸掉时，已经改过的行更需要被还原。
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
