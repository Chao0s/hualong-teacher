/**
 * 亲子任务（`/home-school/parent-tasks` 7 条端点）的探针。**会改数据库，跑完自己收拾。**
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js`、`utils/derived.js`、
 * `services/co-education.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一族要钉的东西与前两条线不同：
 *
 *   计划时刻     `start_at`／`due_at` 是教师挑的，必须**原样存住原样读回** ——
 *                断言钉到**库里的裸值**，不是只看回包的格式。回包格式对而值差
 *                8 小时是真发生过的事（服务端 `fmtAt` 曾把裸值当本地时间转 UTC），
 *                而 `^\d{4}-...\+08:00$` 那种形状断言对 12:00 和 20:00 一样通过。
 *   term_id      发布时按 `start_at` 派生，**不是按今天**。所以用一个落在**上学期**的
 *                `start_at` 打一次 —— 两个值不同，才分得出实作用的是哪一个。
 *   三态两边     s1→s2→s3，且**没有回头路**。每条被拒之后回库里核对状态没变。
 *   404 与 409   状态不符要回 409 并带 `details.from`／`required`，不能混成 404。
 *   看板         按名册**左连接**，不回家长正文。范围断言两头钉。
 *
 *   node tools/probe-parent-task.mjs
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
const api = require_(resolve(MP, 'utils', 'request.js'));
const time = require_(resolve(MP, 'utils', 'time.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);

const db = new Client(DB_URL);
const made = [];

// 数据集基线（STATS.md）。教师 1 是 1 班主班，班上 10 名在园幼儿。
const BASE = { task: 60, submission: 522 };
const CLASS_SIZE = 10;
// 数据集的「今天」是 2026-04-25，当前学期 2025-2026-2（02-23 ~ 07-10）。
// 上学期 2025-2026-1 是 2025-09-01 ~ 2026-01-16，两个学期之间 01-17 ~ 02-22 是空档。
const CURRENT_TERM = '2025-2026-2';
const PREV_TERM = '2025-2026-1';
const IN_PREV_TERM = '2025-11-10T09:00:00+08:00';
const IN_TERM_GAP = '2026-02-01T09:00:00+08:00';

async function counts() {
  const r = await db.query(`SELECT
    (SELECT count(*)::int FROM db_parent_task) AS task,
    (SELECT count(*)::int FROM db_parent_task_submission) AS submission`);
  return r.rows[0];
}

/** 库里那一行的裸值。回包不可信时以这里为准。 */
async function rowOf(id) {
  const r = await db.query(
    `SELECT parent_task_type, parent_task_title, task_background, task_detail,
            to_char(start_at, 'YYYY-MM-DD HH24:MI:SS') AS start_at,
            to_char(due_at,   'YYYY-MM-DD HH24:MI:SS') AS due_at,
            publish_status, term_id, teacher_id, class_id, school_id
       FROM db_parent_task WHERE parent_task_id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

/**
 * 断言某个动作被拒，**且库里那一行的状态没变**。
 *
 * 不可逆动作只测状态码等于没测（CLAUDE.md §7.5）：一个回 409 却真的改了状态的实作，
 * 只看状态码是看不出来的。
 */
async function refuses(label, id, act, expectCode, expectFrom) {
  const before = await rowOf(id);
  let code = '(没被拒)';
  let details = null;
  try {
    await act();
  } catch (err) {
    code = err.code;
    details = err.details;
  }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  if (expectFrom) {
    check(`${label} 带 details.from=${expectFrom}`,
      details && details.from === expectFrom, JSON.stringify(details));
  }
  const after = await rowOf(id);
  check(`${label} 之后库里状态没变（仍 ${before.publish_status}）`,
    after.publish_status === before.publish_status,
    `${before.publish_status} → ${after.publish_status}`);
}

async function main() {
  await db.connect();
  const base = await counts();
  console.log(`基线：parent_task=${base.task} submission=${base.submission}`);
  check('基线与 STATS.md 一致',
    base.task === BASE.task && base.submission === BASE.submission, JSON.stringify(base));

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);
  check('会话的当前学期是 2025-2026-2',
    ctx.current_term && ctx.current_term.term_id === CURRENT_TERM,
    JSON.stringify(ctx.current_term));

  /* ── 读：列表 ─────────────────────────────────────────────────────────── */
  const page = await co.listTasks({ limit: 100 });
  check('列表非空', page.items.length > 0, `拿到 ${page.items.length} 条`);
  has(page.items[0], [
    'id', 'type', 'typeLabel', 'title', 'detail', 'startAt', 'startLabel',
    'status', 'statusLabel', 'doneCount', 'rosterCount', 'doneLabel', 'can',
  ], '列表行');

  check('状态只出现 s1/s2/s3',
    page.items.every((t) => ['s1', 's2', 's3'].includes(t.status)),
    `实际 ${[...new Set(page.items.map((t) => t.status))].join(',')}`);
  check('类型只出现 t1/t2',
    page.items.every((t) => ['t1', 't2'].includes(t.type)),
    `实际 ${[...new Set(page.items.map((t) => t.type))].join(',')}`);
  check('类型译成中文而不是漏出编码',
    page.items.every((t) => ['日常', '社区'].includes(t.typeLabel)),
    `实际 ${[...new Set(page.items.map((t) => t.typeLabel))].join(',')}`);
  check('列表带 task_detail（ParentTask 的必填项）',
    page.items.every((t) => typeof t.detail === 'string' && t.detail.length > 0),
    '有的行没有 detail');

  // 范围**两头钉**：看得见 N 条，且别班那些 id 一个都不在里面（CLAUDE.md §7.4）。
  const mineIds = page.items.map((t) => t.id);
  const inClass = await db.query(
    'SELECT count(*)::int AS n FROM db_parent_task WHERE class_id = 1', [],
  );
  check(`1 班库里 ${inClass.rows[0].n} 条，列表拿到 ${mineIds.length} 条，数目相同`,
    inClass.rows[0].n === mineIds.length, `库 ${inClass.rows[0].n} vs 列表 ${mineIds.length}`);
  const foreign = await db.query(
    'SELECT count(*)::int AS n FROM db_parent_task WHERE parent_task_id = ANY($1::int[]) AND class_id <> 1',
    [mineIds],
  );
  check('列表里没有别班的任务', foreign.rows[0].n === 0, `混进了 ${foreign.rows[0].n} 条`);

  /* ── 读：完成率两个数与库对得上 ───────────────────────────────────────── */
  const dbCounts = await db.query(
    `SELECT t.parent_task_id AS id,
            (SELECT count(*)::int FROM db_parent_task_submission s
              WHERE s.parent_task_id = t.parent_task_id AND s.submission_status='c1') AS done
       FROM db_parent_task t WHERE t.class_id = 1`,
  );
  const expectDone = new Map(dbCounts.rows.map((r) => [r.id, r.done]));
  check('done_count 与库里的 c1 笔数逐条对得上',
    page.items.every((t) => t.doneCount === expectDone.get(t.id)),
    JSON.stringify(page.items.map((t) => [t.id, t.doneCount, expectDone.get(t.id)])));
  check(`roster_count 全部等于本班在园幼儿数 ${CLASS_SIZE}`,
    page.items.every((t) => t.rosterCount === CLASS_SIZE),
    `实际 ${[...new Set(page.items.map((t) => t.rosterCount))].join(',')}`);
  check('草稿不显示完成率（那是一个必然的 0）',
    page.items.filter((t) => t.status === 's1').every((t) => t.showProgress === false),
    '草稿也在显示完成率');

  /* ── 读：计划时刻原样读回（钉到库里的裸值） ──────────────────────────── */
  const withStart = page.items.filter((t) => t.startAt);
  check('每一条都有 start_at（DDL 是 NOT NULL）',
    withStart.length === page.items.length, `${page.items.length - withStart.length} 条没有`);
  const dbTimes = await db.query(
    `SELECT parent_task_id AS id,
            to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS start_wire,
            CASE WHEN due_at IS NULL THEN NULL
                 ELSE to_char(due_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' END AS due_wire
       FROM db_parent_task WHERE class_id = 1`,
  );
  const expectWire = new Map(dbTimes.rows.map((r) => [r.id, r]));
  check('start_at 的线上值 = 库里的裸值缀上 +08:00，一秒不差',
    page.items.every((t) => t.startAt === expectWire.get(t.id).start_wire),
    JSON.stringify(page.items
      .filter((t) => t.startAt !== expectWire.get(t.id).start_wire)
      .map((t) => [t.id, t.startAt, expectWire.get(t.id).start_wire])));
  check('due_at 同样一秒不差，null 就是空串',
    page.items.every((t) => t.dueAt === (expectWire.get(t.id).due_wire || '')),
    JSON.stringify(page.items
      .filter((t) => t.dueAt !== (expectWire.get(t.id).due_wire || ''))
      .map((t) => [t.id, t.dueAt, expectWire.get(t.id).due_wire])));
  check('线上格式是 +08:00 而不是 Z 或裸串',
    page.items.every((t) => time.isWireTimestamp(t.startAt)),
    `实际 ${page.items.slice(0, 3).map((t) => t.startAt).join(',')}`);

  /* ── 读：筛选。缺席＝不加 predicate，不是发一个 all ──────────────────── */
  const onlyT2 = await co.listTasks({ type: 't2', limit: 100 });
  check('type=t2 只回 t2',
    onlyT2.items.length > 0 && onlyT2.items.every((t) => t.type === 't2'),
    `${onlyT2.items.length} 条，类型 ${[...new Set(onlyT2.items.map((t) => t.type))].join(',')}`);
  check('t2 的条数少于全部（筛选真的生效了，不是被忽略）',
    onlyT2.items.length < page.items.length,
    `t2 ${onlyT2.items.length} 条 vs 全部 ${page.items.length} 条`);
  const onlyDraft = await co.listTasks({ status: 's1', limit: 100 });
  check('status=s1 只回草稿',
    onlyDraft.items.every((t) => t.status === 's1'),
    `实际 ${[...new Set(onlyDraft.items.map((t) => t.status))].join(',')}`);

  /* ── 读：看板 ─────────────────────────────────────────────────────────── */
  const published = page.items.find((t) => t.status !== 's1');
  const board = await co.submissionBoard(published.id);
  check(`看板回全班 ${CLASS_SIZE} 行`, board.rows.length === CLASS_SIZE,
    `实际 ${board.rows.length} 行`);
  has(board.rows[0], ['childId', 'name', 'status', 'done', 'underCheck', 'stateLabel', 'stateTone'], '看板行');
  check('看板不回家长正文（契约的 BoardRow 没有这一列）',
    board.rows.every((r) => !('submissionText' in r) && !('submission_text' in r)),
    '正文漏出来了');
  check('看板每一行都有姓名', board.rows.every((r) => r.name), '有行没有 child_name');
  check('状态只出现 c1/c2',
    board.rows.every((r) => ['c1', 'c2'].includes(r.status)),
    `实际 ${[...new Set(board.rows.map((r) => r.status))].join(',')}`);
  check('三档文案只出现 已完成／未完成／审核中',
    board.rows.every((r) => ['已完成', '未完成', '审核中'].includes(r.stateLabel)),
    `实际 ${[...new Set(board.rows.map((r) => r.stateLabel))].join(',')}`);

  const dbBoard = await db.query(
    `SELECT count(*)::int AS n FROM db_parent_task_submission
      WHERE parent_task_id = $1 AND submission_status = 'c1'`,
    [published.id],
  );
  check('看板汇总的已完成数与库里的 c1 笔数一致',
    board.summary.done === dbBoard.rows[0].n,
    `看板 ${board.summary.done} vs 库 ${dbBoard.rows[0].n}`);
  check('汇总的 total = 已完成 + 未完成',
    board.summary.total === board.summary.done + board.summary.undone,
    JSON.stringify(board.summary));

  // 看板按名册左连接：草稿一条提交行都没有，仍要回全班 N 行而不是空集合。
  const draft = page.items.find((t) => t.status === 's1');
  const draftRows = await db.query(
    'SELECT count(*)::int AS n FROM db_parent_task_submission WHERE parent_task_id=$1', [draft.id],
  );
  check('草稿在库里没有任何提交行', draftRows.rows[0].n === 0, `实际 ${draftRows.rows[0].n} 行`);
  const draftBoard = await co.submissionBoard(draft.id);
  check(`零提交行的任务，看板仍回全班 ${CLASS_SIZE} 行（左连接方向没搞反）`,
    draftBoard.rows.length === CLASS_SIZE, `实际 ${draftBoard.rows.length} 行`);
  check('那 10 行全部是未完成', draftBoard.rows.every((r) => r.status === 'c2'),
    JSON.stringify(draftBoard.rows.map((r) => r.status)));

  /* ── 状态机表逐格打一遍 ───────────────────────────────────────────────── */
  check('s1 可改可发布不可结束',
    JSON.stringify(co.allowedTaskActions('s1')) === JSON.stringify({ edit: true, publish: true, close: false }));
  check('s2 只可结束',
    JSON.stringify(co.allowedTaskActions('s2')) === JSON.stringify({ edit: false, publish: false, close: true }));
  check('s3 什么都不可',
    JSON.stringify(co.allowedTaskActions('s3')) === JSON.stringify({ edit: false, publish: false, close: false }));
  check('未知编码降级为什么都不给做，不崩溃也不全放开',
    JSON.stringify(co.allowedTaskActions('s9')) === JSON.stringify({ edit: false, publish: false, close: false }));

  /* ── 本地预检（与服务端规则必须一致） ────────────────────────────────── */
  const ok = {
    type: 't1', title: 'x', detail: 'y', startAt: '2026-05-06T09:00:00+08:00',
  };
  check('齐全时放行', co.whyCannotSaveTask(ok) === '', co.whyCannotSaveTask(ok));
  check('缺类型时说缺类型', co.whyCannotSaveTask({ ...ok, type: '' }) === '请选择任务类型');
  check('缺名称时说缺名称', co.whyCannotSaveTask({ ...ok, title: ' ' }) === '请填写任务名称');
  check('缺详情时说缺详情', co.whyCannotSaveTask({ ...ok, detail: '' }) === '请填写任务详情');
  check('缺开始时间时拦下', co.whyCannotSaveTask({ ...ok, startAt: '' }) !== '');
  check('开始时间是裸串时拦下（不是只看有没有值）',
    co.whyCannotSaveTask({ ...ok, startAt: '2026-05-06 09:00:00' }) !== '');
  check('截止早于开始时拦下',
    co.whyCannotSaveTask({ ...ok, dueAt: '2026-05-05T09:00:00+08:00' }) !== '');
  check('截止为空时放行（due_at 可空）',
    co.whyCannotSaveTask({ ...ok, dueAt: null }) === '');

  /* ── picker 往返：拆开再拼回，一秒不差 ───────────────────────────────── */
  const parts = co.taskPickerParts('2026-05-06T09:30:00+08:00');
  check('拆成 picker 的两个串', parts.date === '2026-05-06' && parts.clock === '09:30',
    JSON.stringify(parts));
  check('拼回去与原值逐字节相同',
    co.taskWireTime(parts.date, parts.clock) === '2026-05-06T09:30:00+08:00',
    co.taskWireTime(parts.date, parts.clock));
  check('默认开始时刻是园所今天 08:00',
    co.defaultTaskStart(Date.parse('2026-04-25T03:00:00Z')) === '2026-04-25T08:00:00+08:00',
    co.defaultTaskStart(Date.parse('2026-04-25T03:00:00Z')));
  // 设备时区不是权威：同一个时刻在任何时区都该算出同一个园所日期。
  check('跨日边界按园所时区算（UTC 16:30 = 园所次日 00:30）',
    co.defaultTaskStart(Date.parse('2026-04-25T16:30:00Z')) === '2026-04-26T08:00:00+08:00',
    co.defaultTaskStart(Date.parse('2026-04-25T16:30:00Z')));

  /* ── 写：建草稿。计划时刻要真的落库 ─────────────────────────────────── */
  const form = {
    type: 't2',
    title: '探针任务（可删）',
    background: '这是探针建的行，脚本结束时会删掉。',
    detail: '请家长陪幼儿完成一次观察记录。',
    startAt: IN_PREV_TERM,
    dueAt: '2025-11-17T18:00:00+08:00',
  };
  const created = await co.createTaskDraft(form);
  check('建立回了 parent_task_id', Boolean(created.id), JSON.stringify(created));
  made.push(created.id);
  check('新建的是草稿 s1', created.status === 's1', created.status);
  check('草稿没有 term_id', created.termId === '', created.termId);

  const stored = await rowOf(created.id);
  check('start_at 落库为裸值 2025-11-10 09:00:00（不是 now()，也没有偏移换算）',
    stored.start_at === '2025-11-10 09:00:00', `实际 ${stored.start_at}`);
  check('due_at 落库为裸值 2025-11-17 18:00:00',
    stored.due_at === '2025-11-17 18:00:00', `实际 ${stored.due_at}`);
  check('type/title/background/detail 四个字段都落了库',
    stored.parent_task_type === 't2' && stored.parent_task_title === form.title
    && stored.task_background === form.background && stored.task_detail === form.detail,
    JSON.stringify(stored));
  check('school_id/class_id/teacher_id 由服务端派生为 1/1/1',
    stored.school_id === 1 && stored.class_id === 1 && stored.teacher_id === 1,
    JSON.stringify([stored.school_id, stored.class_id, stored.teacher_id]));
  check('库里的 publish_status 是 s1', stored.publish_status === 's1', stored.publish_status);

  /* ── 写：格式不符一律 422，且不做转换 ───────────────────────────────── */
  for (const [label, v] of [
    ['裸串', '2026-05-06 09:30:00'],
    ['Z', '2026-05-06T09:30:00Z'],
    ['+09:00', '2026-05-06T09:30:00+09:00'],
  ]) {
    let code = '(没被拒)';
    try {
      const bad = await co.createTaskDraft({ ...form, startAt: v });
      made.push(bad.id);
    } catch (err) { code = err.code; }
    check(`start_at 是 ${label} 时回 422 timestamp_not_accepted`,
      code === 'timestamp_not_accepted', `实际 ${code}`);
  }

  /* ── 写：derived 注入。发出前剥离（DO-NOT-BUILD 8 / §7.3） ───────────── */
  //
  // 走 api.post 而不是 service：service 只把认识的字段拼进 body，注入的键根本到不了
  // utils/derived.js。要测「发出前剥离」就得从 request 层进去。
  const injected = await api.post('/home-school/parent-tasks', {
    body: {
      parent_task_type: 't1',
      parent_task_title: '探针注入（可删）',
      task_detail: '测 derived 剥离。',
      start_at: '2026-05-06T09:00:00+08:00',
      school_id: 999,
      class_id: 999,
      teacher_id: 13,          // 13 是已离职教师
      published_at: '1999-01-01T00:00:00+08:00',
    },
  });
  made.push(injected.parent_task_id);
  const inj = await rowOf(injected.parent_task_id);
  check('注入的 school_id=999 未被采用（仍为 1）', inj.school_id === 1, `实际 ${inj.school_id}`);
  check('注入的 class_id=999 未被采用（仍为 1）', inj.class_id === 1, `实际 ${inj.class_id}`);
  check('注入的 teacher_id=13（离职教师）未被采用（仍为 1）',
    inj.teacher_id === 1, `实际 ${inj.teacher_id}`);
  check('注入 derived 键也不报错，照常建成（§7.3 静默忽略）',
    Boolean(injected.parent_task_id), '这一发被拒了');

  /* ── 写：改草稿。缺席＝不改，null＝清空 ─────────────────────────────── */
  const patched = await co.updateTaskDraft(created.id, {
    title: '探针任务（改过，可删）',
    background: null,
  });
  check('改草稿回 200 且标题改掉', patched.title === '探针任务（改过，可删）', patched.title);
  const afterPatch = await rowOf(created.id);
  check('null 真的清空了 task_background', afterPatch.task_background === null,
    `实际 ${JSON.stringify(afterPatch.task_background)}`);
  check('本次没带的 task_detail 保持原值（缺席＝不改，不是清空）',
    afterPatch.task_detail === form.detail, `实际 ${JSON.stringify(afterPatch.task_detail)}`);
  check('本次没带的 start_at 也没被 now() 顶替',
    afterPatch.start_at === '2025-11-10 09:00:00', `实际 ${afterPatch.start_at}`);

  /* ── 写：发布。term_id 按 start_at 派生，不按今天 ───────────────────── */
  const pub = await co.publishTask(created.id);
  check('发布后 s2', pub.status === 's2', pub.status);
  check(`term_id 取 start_at 所在学期 ${PREV_TERM}，不是今天所在的 ${CURRENT_TERM}`,
    pub.termId === PREV_TERM, `实际 ${pub.termId}`);
  const afterPub = await rowOf(created.id);
  check('库里的 term_id 也是上学期', afterPub.term_id === PREV_TERM, afterPub.term_id);
  check('发布没有动 start_at', afterPub.start_at === '2025-11-10 09:00:00', afterPub.start_at);

  const seeded = await db.query(
    'SELECT count(*)::int AS n FROM db_parent_task_submission WHERE parent_task_id=$1', [created.id],
  );
  check(`发布后为本班 ${CLASS_SIZE} 名在园幼儿各建一行未交提交`,
    seeded.rows[0].n === CLASS_SIZE, `实际 ${seeded.rows[0].n} 行`);

  /* ── 写：s2 之后一切唯读，且 404 与 409 分得开 ──────────────────────── */
  await refuses('改已发布的任务', created.id,
    () => co.updateTaskDraft(created.id, { title: '不该改得动' }),
    'state_precondition_failed', 's2');
  await refuses('重复发布', created.id,
    () => co.publishTask(created.id), 'state_precondition_failed', 's2');

  let ghost = '(没被拒)';
  try { await co.getTask(999999); } catch (err) { ghost = err.code; }
  check('不存在的 id 回 404 not_found，不是 409', ghost === 'not_found', `实际 ${ghost}`);

  /* ── 写：落在学期空档的 start_at 不得发布，且绝不猜一个学期 ─────────── */
  const gapTask = await co.createTaskDraft({ ...form, startAt: IN_TERM_GAP, dueAt: null });
  made.push(gapTask.id);
  await refuses('start_at 落在学期空档时发布', gapTask.id,
    () => co.publishTask(gapTask.id), 'no_active_term', null);
  const gapRow = await rowOf(gapTask.id);
  check('被拒之后 term_id 仍为 null（没有猜一个学期写进去）',
    gapRow.term_id === null, `实际 ${gapRow.term_id}`);
  let gapErr = null;
  try { await co.publishTask(gapTask.id); } catch (err) { gapErr = err; }
  check('这个 409 译成「开始时间不在任何一个学期内」而不是「没有进行中的学期」',
    co.publishFailureText(gapErr).indexOf('学期内') !== -1, co.publishFailureText(gapErr));

  /* ── 写：结束。s3 是终局，没有回头路 ────────────────────────────────── */
  const closed = await co.closeTask(created.id);
  check('结束后 s3', closed.status === 's3', closed.status);
  check('结束后一个动作都不给',
    closed.can.edit === false && closed.can.publish === false && closed.can.close === false,
    JSON.stringify(closed.can));
  await refuses('重复结束', created.id,
    () => co.closeTask(created.id), 'state_precondition_failed', 's3');
  await refuses('把 s3 发布回 s2（契约里没有这条边）', created.id,
    () => co.publishTask(created.id), 'state_precondition_failed', 's3');

  const closedRow = await rowOf(created.id);
  check('结束没有清掉 term_id（归属一经写死就不再变）',
    closedRow.term_id === PREV_TERM, closedRow.term_id);

  /* ── 范围：别班的任务改不动、看不见 ─────────────────────────────────── */
  const otherClass = await db.query(
    "SELECT parent_task_id FROM db_parent_task WHERE class_id <> 1 AND publish_status='s1' LIMIT 1",
  );
  const theirDraft = otherClass.rows[0].parent_task_id;
  const beforeCross = await rowOf(theirDraft);
  let crossCode = '(没被拒)';
  try {
    await co.updateTaskDraft(theirDraft, { title: '越界改名' });
  } catch (err) { crossCode = err.code; }
  check('改别班的草稿回 404（不泄漏存在性）', crossCode === 'not_found', `实际 ${crossCode}`);
  const afterCross = await rowOf(theirDraft);
  check('别班那一行的标题一个字都没变',
    afterCross.parent_task_title === beforeCross.parent_task_title,
    `${beforeCross.parent_task_title} → ${afterCross.parent_task_title}`);
}

async function cleanup() {
  for (const id of made) {
    await db.query('DELETE FROM db_parent_task_submission WHERE parent_task_id=$1', [id]);
    await db.query('DELETE FROM db_parent_task WHERE parent_task_id=$1', [id]);
  }
  // 序列回退，让下一次灌库不出现空洞。
  await db.query("SELECT setval('db_parent_task_parent_task_id_seq', (SELECT max(parent_task_id) FROM db_parent_task))");
  await db.query("SELECT setval('db_parent_task_submission_parent_task_submission_id_seq', (SELECT max(parent_task_submission_id) FROM db_parent_task_submission))");

  const after = await counts();
  console.log(`清理后：parent_task=${after.task} submission=${after.submission}`);
  check('逐表行数回到 STATS.md 的基线',
    after.task === BASE.task && after.submission === BASE.submission, JSON.stringify(after));
}

// 带超时：死锁要红，不要挂住（与 probe-session 同一条理由）。
const timer = setTimeout(() => {
  console.error('探针超时（60s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 60_000);
timer.unref();

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理无论主体成败都跑：主体半途炸掉时，已经建出来的行更需要被收走。
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
