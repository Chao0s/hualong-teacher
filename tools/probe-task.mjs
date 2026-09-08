/**
 * 待办任务三条端点的探针。**会改数据库，跑完自己收拾。**
 *
 *   `GET  /tasks`                       本人的待办清单（游标分页）
 *   `GET  /tasks/{task_id}`             任务详情（含**本人**那一行 assign 与附件）
 *   `POST /tasks/{task_id}/acceptance`  接受（`db_task_assign` a1 → a2）
 *   `POST /tasks/{task_id}/completion`  完成（a2 → a3，可带一段 feedback）
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js`、`services/task.js`、
 * `services/media.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一组要钉的东西：
 *
 *   值钉到库里那一行     标题、说明、分工、截止时间、发起人类型逐字段与 `db_task`
 *                        比对，执行状态与三个时间戳与 `db_task_assign` 比对
 *                        （CLAUDE.md §7.6：形状断言对 12:00 和 20:00 一样通过）
 *   F28 的显示口径       **徽章取 `assign_status`，不取 `task_status`**。数据集里
 *                        两列相反的两笔正好各钉一头：任务 6 是 `t1` 而自己那一行
 *                        是 `a3`（要显示「已完成」，不是「待接收」）；任务 2 是
 *                        `t3` 而自己那一行是 `a1`（要显示「待接收」，不是「已完成」）
 *   列表的排序键         `due_at ASC, task_id ASC`（G63 教师端那一半的答案）。
 *                        期望顺序**从库里按同一条 ORDER BY 算出来**，不写死一串 id；
 *                        再按每页 2 行翻完，结果必须与一次取完逐条相同
 *   范围两头钉           看得见自己那一行 assign，**且同事那几行不在里面**（§7.4）：
 *                        任务 6 回的是 assign 31，不是 32／33／34／35／36；
 *                        名下没有任何 assign 的教师 2 连任务 1 都打不开
 *   不是自己的就不能写     教师 2 对任务 6（`t1`，任务级前置成立）接受与完成都回
 *                        `404`，且那六行 assign 逐列没变、`db_task_assign` 仍是 36 行 ——
 *                        钉的是两条 UPDATE 里的 `teacher_id = $ctx_teacher`
 *   两个动作的两层前置   任务级 `task_status IN ('t1','t2')` 与 assign 级
 *                        `a1`／`a2`，逐格与 `allowedActions()` 比对
 *   `a1` 直接完成必须被拒 §7.5「不可逆动作只测状态码等于没测」：断言
 *                        **409 + `details.rule='requires_a2'` + 库里那一行仍是
 *                        `a1`、`completed_at` 仍为 NULL、`feedback` 仍为 NULL**
 *   任务已 t3 时接受被拒  同一条判据的另一头，钉 `requires_t1_or_t2`，行仍未动
 *   `feedback` 超长被拒   501 字回 422 `max_length_500`，**且行仍是 `a2`**
 *   附件逐条钉到库        每个任务的 `files` 与库里 `db_file_ref(owner_object='db_task',
 *                        owner_id=该任务)` **逐条比对 file_id**，不是断言「等于 0」。
 *                        0 是今天的数据集，不是规则（CLAUDE.md §7.6：断言形状 ≠ 断言值，
 *                        而断言一个常数是同一条教训的又一种形态）—— 哪天真有一份
 *                        任务附件，写死 0 的那一版会把一个正确的客户端判红
 *   G90 的三处分歧        `GET /tasks/{task_id}` 的回包与它自己的 `TaskDetail`
 *                        对不上三处（`assign` 平铺、缺 `creator_type`、缺
 *                        `teacher_id`）。**逐条现测现记**（`sb.note`，不是失败）：
 *                        客户端两种形状都认，服务端补齐之后这几条 note 自己会消失
 *
 * 写入那一半用**教师 3**（黄丽华）跑：她在任务 6（`t1`）上那一行是 `a1`，是数据集里
 * 唯一一条「任务还开着、自己还没接受」的组合。教师 1 名下六行没有这种组合，
 * 拿她跑就永远走不到成功那条路。换人的写法照 `probe-teacher-profile.mjs`。
 *
 *   node tools/probe-task.mjs
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
const api = require_(resolve(MP, 'utils', 'request.js'));
const task = require_(resolve(MP, 'services', 'task.js'));
const media = require_(resolve(MP, 'services', 'media.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const config = require_(resolve(MP, 'config.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const has = sb.has.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

// config.js 的 devSubjectId 是 1：陈静，大一班（class 1），school 1。
const ME = { teacher_id: 1, school_id: 1 };
// 名下一行 assign 都没有的人，用来钉范围的另一头。
const OUTSIDER = { teacher_id: 2 };
// 写入那一半换的人。教师 3 在任务 6（t1）上是 a1 —— 唯一一条「任务开着、还没接受」。
const WRITER = { teacher_id: 3, task_id: 6, assign_id: 32 };

// STATS.md 的基线。跑完必须回到这两个数。
const BASE_TASKS = 6;
const BASE_ASSIGNS = 36;

/** 改动前那一行的原值。收尾时逐列写回去（含 updated_at，见 cleanup）。 */
let snapshot = null;

async function counts() {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM db_task) AS tasks,
            (SELECT count(*)::int FROM db_task_assign) AS assigns`,
  );
  return r.rows[0];
}

/** 一行 assign，时间戳按库里那一行取到分，与客户端的 `formatStamp` 同口径。 */
async function assignRow(assignId) {
  const r = await db.query(
    `SELECT assign_id, task_id, teacher_id, assign_status, feedback,
            accepted_at, completed_at, updated_at,
            to_char(accepted_at,  'YYYY-MM-DD HH24:MI') AS accepted_label,
            to_char(completed_at, 'YYYY-MM-DD HH24:MI') AS completed_label
       FROM db_task_assign WHERE assign_id = $1`,
    [assignId],
  );
  return r.rows[0];
}

/** 一个任务下全部 assign 行的可比较快照。用来证明「拒绝」是真的没写。 */
async function assignsOf(taskId) {
  const r = await db.query(
    `SELECT assign_id, teacher_id, assign_status, accepted_at, completed_at, feedback, updated_at
       FROM db_task_assign WHERE task_id = $1 ORDER BY assign_id`,
    [taskId],
  );
  return r.rows.map((x) => JSON.stringify(x));
}

/**
 * 断言这次动作被拒，**且库里那一行一个字都没变**。
 *
 * 只看状态码不算过（§7.5）：一个回 409 却真的把 `assign_status` 推过去的实作，
 * 只看码是看不出来的。
 */
async function refuses(label, call, expectCode, expectRule, assignId) {
  const before = await assignRow(assignId);
  let code = '(没被拒)';
  let rule = '';
  try {
    await call();
  } catch (err) {
    code = err.code;
    rule = err.details ? String(err.details.rule || '') : '';
  }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  check(`${label} 的 details.rule 是 ${expectRule}`, rule === expectRule, `实际「${rule}」`);
  const after = await assignRow(assignId);
  check(`${label} 之后 assign ${assignId} 的 assign_status 没变（仍是 ${before.assign_status}）`,
    after.assign_status === before.assign_status, `实际 ${after.assign_status}`);
  check(`${label} 之后 assign ${assignId} 的 completed_at 没变`,
    String(after.completed_at) === String(before.completed_at),
    `${before.completed_at} → ${after.completed_at}`);
  check(`${label} 之后 assign ${assignId} 的 feedback 没变`,
    String(after.feedback) === String(before.feedback),
    `${before.feedback} → ${after.feedback}`);
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
  console.log(`基线：db_task=${start.tasks}，db_task_assign=${start.assigns}`);
  check('db_task 基线与 STATS.md 一致', start.tasks === BASE_TASKS, `实际 ${start.tasks}`);
  check('db_task_assign 基线与 STATS.md 一致', start.assigns === BASE_ASSIGNS, `实际 ${start.assigns}`);

  const ctx = await guard.requireSession();
  check('登录成功，角色为 teacher', ctx.role === 'teacher', `role=${ctx.role}`);

  /* ── 读：教师 1 名下每一条任务逐列钉到库 ─────────────────────────────── */

  const mine = (await db.query(
    `SELECT t.task_id, t.task_title, t.task_intro, t.task_division, t.task_status, t.creator_type,
            to_char(t.due_at, 'YYYY-MM-DD HH24:MI') AS due_label,
            a.assign_id, a.assign_status, a.feedback,
            to_char(a.accepted_at,  'YYYY-MM-DD HH24:MI') AS accepted_label,
            to_char(a.completed_at, 'YYYY-MM-DD HH24:MI') AS completed_label
       FROM db_task t
       JOIN db_task_assign a ON a.task_id = t.task_id AND a.teacher_id = $1
      WHERE t.school_id = $2
      ORDER BY t.task_id`,
    [ME.teacher_id, ME.school_id],
  )).rows;
  check(`教师 1 名下有 ${mine.length} 条任务`, mine.length === 6, `实际 ${mine.length} 条`);

  // 每个任务的附件，逐条从库里读出来。**期望值从库里数，不写死 0** ——
  // 0 是今天的数据集，不是规则；写死它就会在第一份任务附件落库的那天
  // 把一个正确的客户端判红（CLAUDE.md §7.6）。
  const fileRefRows = (await db.query(
    `SELECT owner_id::int AS task_id, file_id::int AS file_id
       FROM db_file_ref WHERE owner_object = 'db_task'
      ORDER BY owner_id, file_ref_id`,
  )).rows;
  /** task_id → 该任务的 file_id 数组（库里那一份）。 */
  const expectedFiles = new Map();
  fileRefRows.forEach((r) => {
    if (!expectedFiles.has(r.task_id)) expectedFiles.set(r.task_id, []);
    expectedFiles.get(r.task_id).push(r.file_id);
  });
  // 现测现记，不是断言：今天是 0，所以任务详情页的附件区整块不渲染。
  note(`数据集里 owner_object='db_task' 的 db_file_ref 共 ${fileRefRows.length} 行`,
    fileRefRows.length === 0
      ? '所以每个任务的附件区今天都是空的'
      : `分布在任务 ${[...expectedFiles.keys()].join('、')} 上`);

  /* ── G90：回包形状与契约的三处分歧，现测现记 ──────────────────────────── */

  // 绕开 service 直接看一次原始回包。**只有这一处这么做**：service 已经把两种
  // 形状都接住了，从它的返回值里看不出服务端到底回的是哪一种。
  const raw = await api.get('/tasks/6');
  const nested = Boolean(raw.assign && typeof raw.assign === 'object');
  if (nested) check('回包按契约把本人那一行放在内嵌的 assign 里', true);
  else {
    note('GET /tasks/{task_id} 把 assign 那几列平铺在顶层，契约声明的是内嵌对象（G90）',
      `回包顶层的键：${Object.keys(raw).join(', ')}`);
  }
  const assignPart = nested ? raw.assign : raw;
  // 服务端回了才断言译文；没回就断言**这一枚角标不画**（CLAUDE.md §8）。
  const creatorReturned = raw.creator_type !== undefined;
  if (creatorReturned) check('回包带 creator_type（TaskDetail 标 required）', true);
  else {
    note('GET /tasks/{task_id} 不回 creator_type，而 TaskDetail 标它 required（G90）',
      `回包顶层的键：${Object.keys(raw).join(', ')}`);
  }
  if (assignPart.teacher_id !== undefined) {
    check('回包的 assign 带 teacher_id（TaskAssign 标 required）', true);
  } else {
    note('GET /tasks/{task_id} 的 assign 不回 teacher_id，而 TaskAssign 标它 required（G90）',
      `assign 那一半的键：${Object.keys(assignPart).join(', ')}`);
  }

  for (const row of mine) {
    const got = await task.getTask(row.task_id);
    has(got, ['id', 'title', 'intro', 'division', 'dueLabel', 'can', 'assign', 'files'], `任务 ${row.task_id}`);

    check(`任务 ${row.task_id}：task_title 与库逐字相同（${row.task_title}）`,
      got.title === row.task_title, `实际「${got.title}」`);
    check(`任务 ${row.task_id}：task_intro 与库逐字相同`,
      got.intro === row.task_intro, `实际「${got.intro}」`);
    check(`任务 ${row.task_id}：task_division 与库逐字相同`,
      got.division === row.task_division, `实际「${got.division}」`);
    check(`任务 ${row.task_id}：due_at 钉到库里那一行（${row.due_label}）`,
      got.dueLabel === row.due_label, `实际「${got.dueLabel}」`);
    check(creatorReturned
      ? `任务 ${row.task_id}：creator_type=${row.creator_type}，译成「${task.CREATOR_TYPE[row.creator_type]}」`
      : `任务 ${row.task_id}：服务端不回 creator_type，所以发起人角标不画（G90）`,
    got.creatorLabel === (creatorReturned ? task.CREATOR_TYPE[row.creator_type] : ''),
    `实际「${got.creatorLabel}」`);

    // 范围：回的是**自己那一行** assign，不是同事的。
    check(`任务 ${row.task_id}：回的是自己那一行 assign（${row.assign_id}）`,
      got.assign.assignId === row.assign_id, `实际 ${got.assign.assignId}`);

    // F28：徽章取 assign_status。
    check(`任务 ${row.task_id}：徽章取 assign_status=${row.assign_status}，译成「${task.ASSIGN_STATUS[row.assign_status]}」`,
      got.assign.status === row.assign_status
      && got.assign.statusLabel === task.ASSIGN_STATUS[row.assign_status],
      `实际 ${got.assign.status}／「${got.assign.statusLabel}」`);
    check(`任务 ${row.task_id}：accepted_at 钉到库（${row.accepted_label || '(空)'}）`,
      got.assign.acceptedLabel === (row.accepted_label || ''), `实际「${got.assign.acceptedLabel}」`);
    check(`任务 ${row.task_id}：completed_at 钉到库（${row.completed_label || '(空)'}）`,
      got.assign.completedLabel === (row.completed_label || ''), `实际「${got.assign.completedLabel}」`);
    check(`任务 ${row.task_id}：feedback 与库逐字相同`,
      got.assign.feedback === (row.feedback || ''), `实际「${got.assign.feedback}」`);

    // 两层前置逐格比对：任务级 t1|t2，assign 级 a1／a2。
    const want = task.allowedActions(row.task_status, row.assign_status);
    check(`任务 ${row.task_id}（${row.task_status}／${row.assign_status}）：接受=${want.accept}、完成=${want.complete}`,
      got.can.accept === want.accept && got.can.complete === want.complete,
      JSON.stringify(got.can));

    // 附件逐条与库比对：先比笔数，再比 file_id 集合。只比笔数的话，
    // 取错任务的附件而笔数正好相同时是看不出来的（§7.4 两头钉的同一条理由）。
    const wantFiles = expectedFiles.get(row.task_id) || [];
    check(`任务 ${row.task_id}：附件 ${wantFiles.length} 份，与库里 db_file_ref(owner_object='db_task') 的行数相同`,
      got.files.length === wantFiles.length, `实际 ${got.files.length} 份`);
    check(`任务 ${row.task_id}：附件的 file_id 与库逐个相同（${wantFiles.join('、') || '(无)'}）`,
      got.files.map((f) => f.fileId).join(',') === wantFiles.join(','),
      `实际 ${got.files.map((f) => f.fileId).join(',') || '(无)'}`);
    check(`任务 ${row.task_id}：取档的宿主那一对是 db_task + task_id`,
      got.fileOwner.object === media.OWNER.TASK && got.fileOwner.id === row.task_id,
      JSON.stringify(got.fileOwner));
  }

  /* ── 列表：排序键与范围逐条钉到库 ─────────────────────────────────────── */

  // 期望值从库里按契约的排序键算出来：due_at ASC, task_id ASC。
  // **不写死顺序**，也不拿 mine（那一份按 task_id 排）冒充。
  const wantList = (await db.query(
    `SELECT t.task_id, t.task_title, a.assign_status,
            to_char(t.due_at, 'YYYY-MM-DD HH24:MI') AS due_label
       FROM db_task t
       JOIN db_task_assign a ON a.task_id = t.task_id AND a.teacher_id = $1
      WHERE t.school_id = $2
      ORDER BY t.due_at ASC, t.task_id ASC`,
    [ME.teacher_id, ME.school_id],
  )).rows;

  const list = await task.listTasks({ limit: 100 });
  check(`列表回 ${wantList.length} 行，与库里本人的 assign 行数相同`,
    list.items.length === wantList.length, `实际 ${list.items.length} 行`);
  check('一页取完，游标为空（§3.1：游标为空是结束的唯一信号）',
    list.nextCursor === null, `实际 ${list.nextCursor}`);
  check(`列表顺序是 due_at ASC, task_id ASC（${wantList.map((r) => r.task_id).join('、')}）`,
    list.items.map((r) => r.id).join(',') === wantList.map((r) => r.task_id).join(','),
    `实际 ${list.items.map((r) => r.id).join(',')}`);
  wantList.forEach((row, i) => {
    const got = list.items[i] || {};
    check(`列表第 ${i + 1} 行：标题与库逐字相同（${row.task_title}）`,
      got.title === row.task_title, `实际「${got.title}」`);
    check(`列表第 ${i + 1} 行：截止时间钉到库（${row.due_label}）`,
      got.dueLabel === row.due_label, `实际「${got.dueLabel}」`);
    // F28：卡片上的徽章取 assign_status，不取 task_status。
    check(`列表第 ${i + 1} 行：徽章取 assign_status=${row.assign_status}，译成「${task.ASSIGN_STATUS[row.assign_status]}」`,
      got.status === row.assign_status
      && got.statusLabel === task.ASSIGN_STATUS[row.assign_status],
      `实际 ${got.status}／「${got.statusLabel}」`);
  });

  // 范围两头钉（§7.4）：本园里**别人有而自己没有**的任务，一条都不该在列表里。
  const notMine = (await db.query(
    `SELECT t.task_id FROM db_task t
      WHERE t.school_id = $1
        AND NOT EXISTS (SELECT 1 FROM db_task_assign a
                         WHERE a.task_id = t.task_id AND a.teacher_id = $2)
      ORDER BY t.task_id`,
    [ME.school_id, ME.teacher_id],
  )).rows.map((r) => r.task_id);
  const gotIds = list.items.map((r) => r.id);
  check(`本园里没派给自己的 ${notMine.length} 条任务一条都不在列表里`,
    notMine.every((id) => !gotIds.includes(id)), `列表里是 ${gotIds.join(',')}`);

  // 游标：一页两行翻完，结果必须与一次取完逐条相同。
  const paged = [];
  let cur;
  do {
    const page = await task.listTasks({ cursor: cur, limit: 2 });
    paged.push(...page.items);
    cur = page.nextCursor;
  } while (cur);
  check('按游标每页 2 行翻完，与一次取完逐条相同',
    paged.map((r) => r.id).join(',') === gotIds.join(','), `实际 ${paged.map((r) => r.id).join(',')}`);

  // 首页那张卡片上的数：assign_status 在 a1／a2 的行数。**期望值从库里数。**
  const wantPending = (await db.query(
    `SELECT count(*)::int AS n FROM db_task_assign a JOIN db_task t ON t.task_id = a.task_id
      WHERE a.teacher_id = $1 AND t.school_id = $2 AND a.assign_status IN ('a1','a2')`,
    [ME.teacher_id, ME.school_id],
  )).rows[0].n;
  const gotPending = await task.countPending();
  check(`首页「待处理 N」数出来是 ${wantPending}，与库一致`,
    gotPending === wantPending, `实际 ${gotPending}`);

  /* ── F28 的两头：两列相反时屏幕上跟的是自己那一行 ─────────────────────── */

  const t6 = await task.getTask(6);
  check('任务 6 是 t1 而自己那一行是 a3 —— 徽章显示「已完成」，不是「待接收」',
    t6.assign.statusLabel === task.ASSIGN_STATUS.a3
    && t6.assign.statusLabel !== task.TASK_STATUS.t1,
    `实际「${t6.assign.statusLabel}」`);
  check('任务 6 自己已完成，两个按钮都不给，并说得出原因',
    !t6.can.accept && !t6.can.complete && t6.closedReason.length > 0,
    `${JSON.stringify(t6.can)}／「${t6.closedReason}」`);
  // 同事那五行一行都不该出现在自己的回包里。
  const mates6 = (await db.query(
    'SELECT assign_id FROM db_task_assign WHERE task_id = 6 AND teacher_id <> $1 ORDER BY assign_id',
    [ME.teacher_id],
  )).rows.map((r) => r.assign_id);
  check(`任务 6：同事的 ${mates6.length} 行 assign 一行都不在自己的回包里`,
    !mates6.includes(t6.assign.assignId), `实际 ${t6.assign.assignId}`);

  const t2 = await task.getTask(2);
  check('任务 2 是 t3 而自己那一行是 a1 —— 徽章显示「待接收」，不是「已完成」',
    t2.assign.statusLabel === task.ASSIGN_STATUS.a1
    && t2.assign.statusLabel !== task.TASK_STATUS.t3,
    `实际「${t2.assign.statusLabel}」`);
  check('任务 2 已 t3，虽然自己还是 a1，接受按钮也不给（任务级前置）',
    !t2.can.accept && !t2.can.complete && t2.closedReason.length > 0,
    `${JSON.stringify(t2.can)}／「${t2.closedReason}」`);

  // 客户端不给按钮，服务端也必须拒 —— 两道判据各钉一次（§7.5）。
  await refuses('任务已 t3 时接受', () => task.accept(2),
    'state_precondition_failed', 'requires_t1_or_t2', 7);

  /* ── 范围的另一头：名下没有 assign 的教师连打都打不开 ─────────────────── */

  await asTeacher(OUTSIDER.teacher_id, async () => {
    const outsiderRows = (await db.query(
      'SELECT count(*)::int AS n FROM db_task_assign WHERE teacher_id = $1',
      [OUTSIDER.teacher_id],
    )).rows[0].n;
    check('教师 2 名下一行 assign 都没有', outsiderRows === 0, `实际 ${outsiderRows} 行`);
    // 列表的范围另一头：名下没有 assign 的人拿到的是空清单，不是全园任务。
    const outsiderList = await task.listTasks({ limit: 100 });
    check('教师 2 的待办清单是 0 行', outsiderList.items.length === 0,
      `实际 ${outsiderList.items.length} 行`);
    const outsiderPending = await task.countPending();
    check('教师 2 首页的「待处理 N」是 0', outsiderPending === 0, `实际 ${outsiderPending}`);
    let code = '(没被拒)';
    try { await task.getTask(1); } catch (err) { code = err.code; }
    check('教师 2 打开任务 1 回 not_found（与「任务不存在」逐字节相同，§2.3）',
      code === 'not_found', `实际 ${code}`);

    // 写的那一头也要钉。任务 6 是 `t1`，任务级前置成立，所以这里唯一能拒它的判据
    // 就是两条 UPDATE 里的 `teacher_id = $ctx_teacher` —— 去掉那一格，下面四条立刻红。
    // 只看状态码不算过（§7.5）：还要证明六行 assign 一个字都没动，且没有为教师 2
    // 新建一行。
    const before6 = await assignsOf(6);
    let acceptCode = '(没被拒)';
    try { await task.accept(6); } catch (err) { acceptCode = err.code; }
    check('教师 2 接受不属于自己的任务 6 回 not_found', acceptCode === 'not_found', `实际 ${acceptCode}`);
    let completeCode = '(没被拒)';
    try { await task.complete(6, '不该落库的反馈'); } catch (err) { completeCode = err.code; }
    check('教师 2 完成不属于自己的任务 6 回 not_found', completeCode === 'not_found', `实际 ${completeCode}`);
    const after6 = await assignsOf(6);
    check('两次越权写之后任务 6 的 6 行 assign 逐列没变',
      after6.join('|') === before6.join('|'), after6.join('|'));
    const nAssign = (await counts()).assigns;
    check(`db_task_assign 仍是 ${BASE_ASSIGNS} 行 —— 没有为教师 2 新建一行`,
      nAssign === BASE_ASSIGNS, `实际 ${nAssign}`);
  });

  /* ── 写：换教师 3，任务 6 是 t1、她那一行是 a1 ────────────────────────── */

  await asTeacher(WRITER.teacher_id, async () => {
    snapshot = await assignRow(WRITER.assign_id);
    check(`教师 3 在任务 6 上那一行是 a1（assign ${WRITER.assign_id}）`,
      snapshot.assign_status === 'a1', `实际 ${snapshot.assign_status}`);

    const before = await task.getTask(WRITER.task_id);
    check('a1 时只给「接受」，不给「完成」—— 转移图上没有 a1 → a3 这条边',
      before.can.accept && !before.can.complete, JSON.stringify(before.can));

    // 负例：a1 直接完成。**状态码 + 库里那一行一起钉**（§7.5）。
    await refuses('a1 直接完成', () => task.complete(WRITER.task_id, '探针不该写进去的反馈'),
      'state_precondition_failed', 'requires_a2', WRITER.assign_id);

    /* 接受：a1 → a2 */
    const accepted = await task.accept(WRITER.task_id);
    check('接受回 a2', accepted.assign_status === 'a2', `实际 ${accepted.assign_status}`);
    let row = await assignRow(WRITER.assign_id);
    check('库里那一行落到 a2', row.assign_status === 'a2', `实际 ${row.assign_status}`);
    check('accepted_at 由服务端写上了', Boolean(row.accepted_at), '仍是空的');
    check('completed_at 仍为空', row.completed_at === null, `实际 ${row.completed_at}`);

    const mid = await task.getTask(WRITER.task_id);
    check('接受之后徽章变「进行中」',
      mid.assign.statusLabel === task.ASSIGN_STATUS.a2, `实际「${mid.assign.statusLabel}」`);
    check('接受之后只给「完成」，不再给「接受」',
      !mid.can.accept && mid.can.complete, JSON.stringify(mid.can));
    check('accepted_at 回包与库里那一行相同',
      mid.assign.acceptedLabel === (await assignRow(WRITER.assign_id)).accepted_label,
      `实际「${mid.assign.acceptedLabel}」`);

    /* 超长反馈：本地先拦，服务端也要拒，且行仍是 a2 */
    const tooLong = '长'.repeat(task.FEEDBACK_MAX + 1);
    check('超长反馈本地预检拦得下来',
      task.whyCannotComplete(tooLong) === `任务反馈最多 ${task.FEEDBACK_MAX} 字`,
      `实际「${task.whyCannotComplete(tooLong)}」`);
    await refuses('超长反馈提交完成', () => task.complete(WRITER.task_id, tooLong),
      'validation_failed', 'max_length_500', WRITER.assign_id);

    /* 完成：a2 → a3，带一段反馈 */
    const text = '探针写的任务反馈';
    check('正常长度的反馈本地预检放行',
      task.whyCannotComplete(text) === '', `实际「${task.whyCannotComplete(text)}」`);
    const done = await task.complete(WRITER.task_id, text);
    check('完成回 a3', done.assign_status === 'a3', `实际 ${done.assign_status}`);
    row = await assignRow(WRITER.assign_id);
    check('库里那一行落到 a3', row.assign_status === 'a3', `实际 ${row.assign_status}`);
    check('completed_at 由服务端写上了', Boolean(row.completed_at), '仍是空的');
    check(`feedback 与送出去的那一段逐字相同（${text}）`, row.feedback === text, `实际「${row.feedback}」`);

    const after = await task.getTask(WRITER.task_id);
    check('完成之后徽章变「已完成」',
      after.assign.statusLabel === task.ASSIGN_STATUS.a3, `实际「${after.assign.statusLabel}」`);
    check('完成之后两个按钮都不给，并说得出原因',
      !after.can.accept && !after.can.complete && after.closedReason.length > 0,
      `${JSON.stringify(after.can)}／「${after.closedReason}」`);
    check('完成之后回包里的 feedback 与库一致',
      after.assign.feedback === text, `实际「${after.assign.feedback}」`);

    // 两个教师端动作一个字都不碰 db_task（F28：两列互不派生）。
    const t = (await db.query('SELECT task_status FROM db_task WHERE task_id = $1', [WRITER.task_id])).rows[0];
    check('接受与完成都没有改动 db_task.task_status（仍是 t1）',
      t.task_status === 't1', `实际 ${t.task_status}`);
  });

  check('换回原教师后会话正常', Boolean(session.getToken()), '没有票');
}

/**
 * 收拾：把教师 3 那一行写回原值。
 *
 * **本探针改的是数据集里已有的一行，不是自己建的行**，所以收拾是「写回」而不是
 * 「删掉」。`updated_at` 由 `trg_task_assign_touch` 在每次 UPDATE 时覆写，写不回去 ——
 * 所以这一次写回把该触发器停掉再开回来，否则库里会留下一个漂掉的 `updated_at`，
 * 而多处业务规则按它排序（`01_schema.sql:26`）。
 */
async function cleanup() {
  if (snapshot) {
    await db.query('BEGIN');
    try {
      await db.query('ALTER TABLE db_task_assign DISABLE TRIGGER trg_task_assign_touch');
      await db.query(
        `UPDATE db_task_assign
            SET assign_status = $2, accepted_at = $3, completed_at = $4,
                feedback = $5, updated_at = $6
          WHERE assign_id = $1`,
        [snapshot.assign_id, snapshot.assign_status, snapshot.accepted_at,
          snapshot.completed_at, snapshot.feedback, snapshot.updated_at],
      );
      await db.query('ALTER TABLE db_task_assign ENABLE TRIGGER trg_task_assign_touch');
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
    const back = await assignRow(snapshot.assign_id);
    check(`收拾干净：assign ${snapshot.assign_id} 五列逐列写回原值`,
      back.assign_status === snapshot.assign_status
      && String(back.accepted_at) === String(snapshot.accepted_at)
      && String(back.completed_at) === String(snapshot.completed_at)
      && String(back.feedback) === String(snapshot.feedback)
      && String(back.updated_at) === String(snapshot.updated_at),
      JSON.stringify(back));
  }
  const end = await counts();
  check(`逐表行数回到 STATS.md 的基线（db_task=${BASE_TASKS}，db_task_assign=${BASE_ASSIGNS}）`,
    end.tasks === BASE_TASKS && end.assigns === BASE_ASSIGNS, JSON.stringify(end));
}

// 带超时：死锁要红，不要挂住（与 probe-session 同一条理由）。
const timer = setTimeout(() => {
  console.error('探针超时（60s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 60_000);
timer.unref();

// 收拾放在**尾链上**，不放在 main() 里：main() 中途抛错时也要把那一行写回去。
main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  .then(async () => {
    try {
      await cleanup();
    } catch (err) {
      check(`收拾失败，assign ${WRITER.assign_id} 可能还停在改动后的状态：${err && err.message}`, false);
    }
    try { await db.end(); } catch { /* 已经断开就算了 */ }
    clearTimeout(timer);
    sb.report();
  });
