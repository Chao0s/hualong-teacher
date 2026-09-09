/**
 * 教师寄语的探针。**会改数据库，跑完自己收拾。**
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 与
 * `services/assessment.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一族要钉的东西：
 *
 *   唯一键无 teacher_id  `uk_tm_child_term UNIQUE (child_id, term_id)` —— 同班配班
 *                        教师读到的是**同一行**。断言钉「教师 2 读到的
 *                        `teacher_message_id` 与教师 1 写的那一个逐字相同，
 *                        且 `teacher_id` 仍是 1」。写成 teacher-keyed 的实作在这里红。
 *   永久只读             已有行的 `PUT` 回 409，**且库里那一行一个字都没变**（§7.5）。
 *                        一个回 409 却真的覆写了的实作，只看状态码是看不出来的。
 *   没有 take over        全班扇出遇到已有行 skip，不覆写 —— 所以扇出之后
 *                        child 1 的正文仍是它自己那一段，不是扇出的那一段。
 *   零写入               指纹漂移回 409 且**行数一行都没变**。
 *   指纹的两条性质        同一份 `e1` 名册算出同一个值；名册减一个／再加回来，
 *                        值先变、再回到原值。名册的增减靠临时改
 *                        `db_child.enrollment_status` 造出来，跑完还原。
 *   范围两头钉            「看得见 10 行」不够：范围改坏了也可能照样是 10 行。同时钉
 *                        「别班的 child_id 一个都没漏进来」「非 `e1` 的两名幼儿
 *                        (55 e3 / 60 e2) 一个都没出现」「别班教师读 child 1 回 404」。
 *   钉值不钉形状          `created_at` 拿
 *                        `to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00'`
 *                        与回包逐字比（§7.6），不比正则。
 *   无进行中学期          读端点回 **200** 加 `term_id: null`、三个计数 0；写端点回
 *                        **409 `no_active_term`**。这一分支靠把当前学期的
 *                        `start_date` 临时推到「今天」之后造出来，跑完还原。
 *
 * ── 会改哪几张表 ──────────────────────────────────────────────────────────
 *
 *   db_teacher_message   本探针建的行，跑完逐条删掉，并核对行数回到 60。
 *   db_child             child 10 的 `enrollment_status` 临时 e1→e2→e1（指纹那一条）。
 *   db_school_term       term 2 的 `start_date` 临时推后（无学期那一条）。
 *
 * 后两张是**借用**，不是本探针的产出：改动都在 `DISABLE TRIGGER` 之间做，所以
 * `updated_at` 一动都不动，还原之后逐列与基线逐字相同。清理那一步把这三张表各自
 * 再核一遍 —— 行数对不代表值对。
 *
 * **本探针的验收口径是 0 项失败。**
 *
 *   node tools/probe-teacher-message.mjs
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
const assess = require_(resolve(MP, 'services', 'assessment.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const api = require_(resolve(MP, 'utils', 'request.js'));
const time = require_(resolve(MP, 'utils', 'time.js'));
const config = require_(resolve(MP, 'config.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

/* ── 基线（STATS.md + 2026-09-09 实测）───────────────────────────────────── */

/** `db_teacher_message` 60 行，**全在上学期**；当前学期 0 行。 */
const BASE_ROWS = 60;
/** 教师 1（陈静，r1 主班）在 1 班；教师 2（李婉婷，r2 配班）同班。 */
const TEACHER = 1;
const COLLEAGUE = 2;
const CLASS_ID = 1;
const SCHOOL_ID = 1;
const CLASS_SIZE = 10;
/** 数据集的「今天」是 2026-04-25，所以当前学期是第二学期。 */
const CURRENT_TERM = '2025-2026-2';
const PREV_TERM = '2025-2026-1';
/** 本探针的单条提交打在 child 1 身上。 */
const TARGET_CHILD = 1;
/** 教师 11（刘敏怡）在 6 班：8 名 e1，child 55 是 e3、child 60 是 e2。 */
const OTHER_TEACHER = 11;
const OTHER_CLASS_E1 = [51, 52, 53, 54, 56, 57, 58, 59];
const OTHER_CLASS_NOT_E1 = [55, 60];
/** 指纹那一条借 child 10 造名册增减。 */
const FLIP_CHILD = 10;

const SINGLE_TEXT = '小明这学期从害羞到主动举手，进步很大。';
const CLASS_TEXT = '祝每个小朋友假期健康快乐，开学再见。';

async function scalar(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

async function rowCount() {
  return scalar('SELECT count(*)::int FROM db_teacher_message');
}

/** 库里那一行，`created_at` 按服务端该回的样子拼好，供逐字比对（§7.6）。 */
async function tmRow(childId, termId = CURRENT_TERM) {
  const r = await db.query(
    `SELECT teacher_message_id, school_id, class_id, child_id, teacher_id, term_id, content,
            to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00' AS created_text
       FROM db_teacher_message WHERE child_id = $1 AND term_id = $2`,
    [childId, termId],
  );
  return r.rows[0] || null;
}

/** 换一位教师登录，跑完这一段再换回去。与 probe-growth-book 同一个写法。 */
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

/**
 * 在 `DISABLE TRIGGER` 之间改一次，`updated_at` 因此一动都不动。
 *
 * `touch_updated_at` 是 BEFORE UPDATE 触发器，把 `updated_at` 盖成
 * `CURRENT_TIMESTAMP`，所以**在同一条 UPDATE 里把它写回去是无效的**。借来的两张表
 * （`db_child`／`db_school_term`）是名册与配置，留一个改过的 `updated_at` 在里面，
 * 下一支探针会以为有人动过数据。
 */
async function quietUpdate(table, trigger, sql, params) {
  await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  try {
    await db.query(sql, params);
  } finally {
    await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  }
}

/* ── 组 1 · 进度看板 ────────────────────────────────────────────────────── */

async function groupBoard() {
  console.log('\n[board] 进度看板 —— GET /teacher-messages');

  const board = await assess.messageBoard();

  check(`看板回 ${CLASS_SIZE} 行（本班 e1 名册整份）`,
    board.rows.length === CLASS_SIZE, `拿到 ${board.rows.length} 行`);
  check('按 child_id 升序，第一行是 child 1',
    board.rows.map((r) => r.childId).join(',') === '1,2,3,4,5,6,7,8,9,10',
    board.rows.map((r) => r.childId).join(','));
  check(`termId 是 ${CURRENT_TERM}`, board.termId === CURRENT_TERM, `实际 ${board.termId}`);
  check('rosterFingerprint 是非空字符串',
    typeof board.rosterFingerprint === 'string' && board.rosterFingerprint.length > 0,
    `实际 ${JSON.stringify(board.rosterFingerprint)}`);
  check('canSubmit 为 true（学期在、名册非空）', board.canSubmit === true, `实际 ${board.canSubmit}`);

  // 三个计数钉到库里重算一遍，不信回包自己说的。
  const dbExisting = await scalar(
    `SELECT count(*)::int FROM db_child ch
       JOIN db_teacher_message m ON m.child_id = ch.child_id AND m.term_id = $2
      WHERE ch.class_id = $1 AND ch.enrollment_status = 'e1'`,
    [CLASS_ID, CURRENT_TERM]);
  check(`summary 与库里逐格相同（total ${CLASS_SIZE} / done ${dbExisting}）`,
    board.summary.total === CLASS_SIZE && board.summary.done === dbExisting
    && board.summary.undone === CLASS_SIZE - dbExisting,
    `${JSON.stringify(board.summary)} / 库 done=${dbExisting}`);

  // 逐行钉到库里：无行就该是 c2 且 teacherMessageId 为 null。
  for (const row of board.rows) {
    const dbRow = await tmRow(row.childId);
    check(`child ${row.childId} 的 status 与库里那一行相符`,
      row.status === (dbRow ? 'c1' : 'c2'),
      `回包 ${row.status} / 库 ${dbRow ? '有行' : '无行'}`);
    check(`child ${row.childId} 的 teacherMessageId 与库里那一行相符`,
      row.teacherMessageId === (dbRow ? dbRow.teacher_message_id : null),
      `回包 ${row.teacherMessageId} / 库 ${dbRow ? dbRow.teacher_message_id : 'null'}`);
  }
  check('当前学期一条寄语都还没有，全班 c2',
    board.rows.every((r) => r.status === 'c2') && board.summary.done === 0,
    JSON.stringify(board.summary));
  check('statusLabel 只有「未完成」，没有「草稿」这一档',
    board.rows.every((r) => r.statusLabel === '未完成'),
    [...new Set(board.rows.map((r) => r.statusLabel))].join(','));
  check('未提交的那一行 submittedLabel 是「—」，不是一个编出来的日期',
    board.rows.every((r) => r.submittedLabel === '—'),
    [...new Set(board.rows.map((r) => r.submittedLabel))].join(','));

  // 范围两头钉：只写「10 行」不够，范围改坏了也可能照样是 10 行。
  const mine = board.rows.map((r) => r.childId);
  const others = await db.query(
    'SELECT child_id FROM db_child WHERE class_id <> $1', [CLASS_ID]);
  const leaked = others.rows.map((r) => r.child_id).filter((id) => mine.includes(id));
  check('别班的幼儿一个都没漏进来', leaked.length === 0, `漏了 ${leaked.join(',')}`);

  // 上学期那 60 行一条都不该出现：本端点没有 term_id 参数，学期由服务端派生。
  const prevIds = await db.query(
    'SELECT teacher_message_id FROM db_teacher_message WHERE term_id = $1', [PREV_TERM]);
  const prevSet = new Set(prevIds.rows.map((r) => r.teacher_message_id));
  check(`上学期那 ${prevIds.rows.length} 行的 id 一个都没出现在看板上`,
    board.rows.every((r) => !prevSet.has(r.teacherMessageId)),
    board.rows.filter((r) => prevSet.has(r.teacherMessageId)).map((r) => r.childId).join(','));

  // 6 班：8 名 e1，child 55 (e3) 与 child 60 (e2) 一个都不该出现。
  await asTeacher(OTHER_TEACHER, async () => {
    const other = await assess.messageBoard();
    check(`6 班看板回 ${OTHER_CLASS_E1.length} 行（只 e1）`,
      other.rows.length === OTHER_CLASS_E1.length, `拿到 ${other.rows.length} 行`);
    check('6 班看板的 child_id 逐个对上 e1 名册',
      other.rows.map((r) => r.childId).join(',') === OTHER_CLASS_E1.join(','),
      other.rows.map((r) => r.childId).join(','));
    const bad = other.rows.map((r) => r.childId).filter((id) => OTHER_CLASS_NOT_E1.includes(id));
    check(`非 e1 的 child ${OTHER_CLASS_NOT_E1.join(' 与 ')} 一个都没出现`,
      bad.length === 0, `出现了 ${bad.join(',')}`);
    check('6 班的 roster_e1_count 是 8，不是 10（名册里那 10 名幼儿的 8 名在园）',
      other.summary.total === OTHER_CLASS_E1.length, `实际 ${other.summary.total}`);
    check('6 班的指纹与 1 班不同（不同名册不同值）',
      other.rosterFingerprint !== board.rosterFingerprint,
      `两班都是 ${other.rosterFingerprint}`);
  });
}

/* ── 组 2 · 单幼儿提交与永久只读 ─────────────────────────────────────────── */

/** 本探针建的行，`cleanup()` 逐条删。 */
const made = [];

async function groupSingle() {
  console.log('\n[single] 单幼儿提交 —— PUT/GET /children/{child_id}/teacher-message');

  // 无行时 service 把 404 换成 null —— 那不是错误，是「本学期尚未提交」。
  const before = await assess.getTeacherMessage(TARGET_CHILD);
  check(`child ${TARGET_CHILD} 本学期无行时 getTeacherMessage 回 null（不抛错）`,
    before === null, `实际 ${JSON.stringify(before)}`);

  // 客户端到底有没有带上必填的 Idempotency-Key —— 不带的话服务端回 422。
  // 这一条钉的是 request.js 那张 IDEMPOTENT_ACTIONS 表对 **PUT** 也生效
  // （teacher_message.submit 的动词是 PUT，不是 POST）。
  let noKey = null;
  try {
    await api.put(`/children/${TARGET_CHILD}/teacher-message`, { body: { content: SINGLE_TEXT } });
  } catch (err) { noKey = err; }
  check('不带 action 直发 PUT 会被服务端以 Idempotency-Key required 打回',
    noKey && noKey.code === 'validation_failed'
    && noKey.details && noKey.details.field === 'Idempotency-Key',
    `实际 ${noKey ? `${noKey.code}/${JSON.stringify(noKey.details)}` : '(没报错)'}`);

  const rowsBefore = await rowCount();

  // 正文前后各留空格：服务端与 service 都该 trim 之后再落库。
  const out = await assess.submitTeacherMessage(TARGET_CHILD, { content: `  ${SINGLE_TEXT}  ` });
  const dbRow = await tmRow(TARGET_CHILD);
  check('提交之后库里多了正好一行', await rowCount() === rowsBefore + 1,
    `${rowsBefore} → ${await rowCount()}`);
  if (dbRow) made.push(dbRow.teacher_message_id);
  check(`库里 child ${TARGET_CHILD} / ${CURRENT_TERM} 有了一行`, Boolean(dbRow), '没有这一行');
  if (!dbRow) return;

  // 九列逐格钉到库里。四个派生列服务端自己填，客户端一个都没发。
  check('content 落库时前后空格已 trim', dbRow.content === SINGLE_TEXT,
    `库里 ${JSON.stringify(dbRow.content)}`);
  check(`school_id 是服务端填的 ${SCHOOL_ID}`, dbRow.school_id === SCHOOL_ID, `实际 ${dbRow.school_id}`);
  check(`class_id 是服务端填的 ${CLASS_ID}`, dbRow.class_id === CLASS_ID, `实际 ${dbRow.class_id}`);
  check(`teacher_id 是服务端填的 ${TEACHER}`, dbRow.teacher_id === TEACHER, `实际 ${dbRow.teacher_id}`);
  check(`term_id 是服务端按日期派生的 ${CURRENT_TERM}`, dbRow.term_id === CURRENT_TERM, `实际 ${dbRow.term_id}`);

  // 回包与库里逐字比，**不比正则**（§7.6）。
  check('PUT 回包的 teacher_message_id 与库里那一行相同',
    out.teacher_message_id === dbRow.teacher_message_id,
    `回包 ${out.teacher_message_id} / 库 ${dbRow.teacher_message_id}`);
  check(`PUT 回包的 created_at 与库里逐字相同（${dbRow.created_text}）`,
    out.created_at === dbRow.created_text, `回包 ${out.created_at}`);
  check('PUT 回包的 content 与库里逐字相同', out.content === dbRow.content, `回包 ${JSON.stringify(out.content)}`);

  // 读回来：service 的字段名与派生。
  const got = await assess.getTeacherMessage(TARGET_CHILD);
  check('getTeacherMessage 的 content 与库里逐字相同', got.content === dbRow.content, JSON.stringify(got.content));
  check('getTeacherMessage 的 teacherMessageId 与库里相同',
    got.teacherMessageId === dbRow.teacher_message_id, `实际 ${got.teacherMessageId}`);
  check('getTeacherMessage 回 teacherName（名册左连接派生，本表无此列）',
    got.teacherName === '陈静', `实际 ${JSON.stringify(got.teacherName)}`);
  check('getTeacherMessage 回 childName',
    got.childName === (await scalar('SELECT child_name FROM db_child WHERE child_id=$1', [TARGET_CHILD])),
    `实际 ${JSON.stringify(got.childName)}`);
  // 钉到库里那一行算出来的那个串，**不写「不是『—』」** —— 后者对任何非空字符串
  // 都成立，格式化译错了也照样绿（§7.6）。
  check(`submittedLabel 与库里 created_at 格式化出来的逐字相同（${time.formatStamp(dbRow.created_text)}）`,
    got.submittedLabel === time.formatStamp(dbRow.created_text), `实际 ${got.submittedLabel}`);
  // 钉**回包**而不是 service 的返回值：service 是显式拼出来的对象，问它有没有
  // `publishedAt` 恒为 false，那是在考自己。DDL 上没有这两列，服务端也不许发明一个。
  const rawOne = await api.get(`/children/${TARGET_CHILD}/teacher-message`);
  check('回包里没有 published_at 也没有 submitted_at（DDL 上没有这两列）',
    !('published_at' in rawOne) && !('submitted_at' in rawOne),
    Object.keys(rawOne).join(','));
  check(`回包的键正好是契约 TeacherMessage 那 8 个`,
    Object.keys(rawOne).slice().sort().join(',')
      === ['child_id', 'child_name', 'content', 'created_at', 'teacher_id', 'teacher_message_id', 'teacher_name', 'term_id'].join(','),
    Object.keys(rawOne).slice().sort().join(','));

  // ── 永久只读：409 + 库里那一行一个字都没变（§7.5）───────────────────────
  let again = null;
  try {
    await assess.submitTeacherMessage(TARGET_CHILD, { content: '换一段完全不同的正文。' });
  } catch (err) { again = err; }
  check('已有行的第二次提交回 409 state_precondition_failed',
    again && again.code === 'state_precondition_failed',
    `实际 ${again ? again.code : '(竟然成功了)'}`);
  const afterReject = await tmRow(TARGET_CHILD);
  check('被拒之后库里那一行的 content 一个字都没变',
    afterReject && afterReject.content === SINGLE_TEXT,
    `实际 ${JSON.stringify(afterReject && afterReject.content)}`);
  check('被拒之后 teacher_message_id 与 created_at 都没变（不是删了重建）',
    afterReject && afterReject.teacher_message_id === dbRow.teacher_message_id
    && afterReject.created_text === dbRow.created_text,
    `${JSON.stringify(afterReject)}`);
  check('被拒之后行数没变（没有偷偷插第二行）', await rowCount() === rowsBefore + 1,
    `实际 ${await rowCount()}`);
  check('messageFailureText 把 409 译成「永久只读」那句',
    /永久只读/.test(assess.messageFailureText(again)), assess.messageFailureText(again));

  // ── 唯一键不含 teacher_id：配班教师读到同一行 ─────────────────────────
  await asTeacher(COLLEAGUE, async () => {
    const mate = await assess.getTeacherMessage(TARGET_CHILD);
    check(`配班教师 ${COLLEAGUE} 读到的是同一行（teacher_message_id 相同）`,
      mate && mate.teacherMessageId === dbRow.teacher_message_id,
      `实际 ${mate ? mate.teacherMessageId : 'null'} / 期望 ${dbRow.teacher_message_id}`);
    check(`配班教师读到的 teacher_id 仍是撰写人 ${TEACHER}，不是他自己`,
      mate && mate.teacherId === TEACHER, `实际 ${mate ? mate.teacherId : 'null'}`);
    const mateBoard = await assess.messageBoard();
    const cell = mateBoard.rows.find((r) => r.childId === TARGET_CHILD);
    check(`配班教师的看板上 child ${TARGET_CHILD} 是已完成，不是未完成`,
      cell && cell.done === true, `实际 ${cell ? cell.status : '(没这一行)'}`);
  });

  // ── 别班教师读不到（范围回 404，不回 403）─────────────────────────────
  await asTeacher(OTHER_TEACHER, async () => {
    const outside = await assess.getTeacherMessage(TARGET_CHILD);
    check(`6 班教师 ${OTHER_TEACHER} 读 child ${TARGET_CHILD} 回 404（service 换成 null）`,
      outside === null, `实际 ${JSON.stringify(outside)}`);
    let wrote = null;
    const rowsNow = await rowCount();
    try {
      await assess.submitTeacherMessage(OTHER_CLASS_NOT_E1[0], { content: '给一个非在园幼儿写。' });
    } catch (err) { wrote = err; }
    check(`给非 e1 的 child ${OTHER_CLASS_NOT_E1[0]} 提交回 404`,
      wrote && wrote.code === 'not_found', `实际 ${wrote ? wrote.code : '(竟然成功了)'}`);
    check('那一发被拒之后行数没变', await rowCount() === rowsNow, `实际 ${await rowCount()}`);
  });
}

/* ── 组 3 · 全班扇出与指纹 ──────────────────────────────────────────────── */

async function groupClass() {
  console.log('\n[class] 全班扇出 —— POST /teacher-messages');

  const board = await assess.messageBoard();
  const existingBefore = board.summary.done;
  const rowsBefore = await rowCount();

  // ── 指纹的两条性质 ────────────────────────────────────────────────────
  const twice = await assess.messageBoard();
  check('同一份 e1 名册，两次取到同一个指纹',
    twice.rosterFingerprint === board.rosterFingerprint,
    `${board.rosterFingerprint} vs ${twice.rosterFingerprint}`);

  // 名册减一个：child 10 临时改成 e2（已毕业）。
  await quietUpdate('db_child', 'trg_child_touch',
    "UPDATE db_child SET enrollment_status = 'e2' WHERE child_id = $1", [FLIP_CHILD]);
  const shrunk = await assess.messageBoard();
  check(`名册减一名（child ${FLIP_CHILD} 改 e2）之后指纹变了`,
    shrunk.rosterFingerprint !== board.rosterFingerprint,
    `还是 ${shrunk.rosterFingerprint}`);
  check(`名册减一名之后 roster_e1_count 从 ${CLASS_SIZE} 变成 ${CLASS_SIZE - 1}`,
    shrunk.summary.total === CLASS_SIZE - 1, `实际 ${shrunk.summary.total}`);
  check(`child ${FLIP_CHILD} 从看板上消失了`,
    shrunk.rows.every((r) => r.childId !== FLIP_CHILD), '他还在表上');

  // 拿刚才那份旧指纹去提交 —— 名册已经漂了，该 409 且零写入。
  let drift = null;
  const rowsAtDrift = await rowCount();
  try {
    await assess.submitTeacherMessagesForClass({
      content: CLASS_TEXT, rosterFingerprint: board.rosterFingerprint,
    });
  } catch (err) { drift = err; }
  check('拿漂了的指纹提交回 409 fingerprint_drift',
    drift && drift.code === 'fingerprint_drift',
    `实际 ${drift ? drift.code : '(竟然成功了)'}`);
  check('指纹漂移那一发**零写入**：行数一行都没变',
    await rowCount() === rowsAtDrift, `${rowsAtDrift} → ${await rowCount()}`);
  check('409 附回刷新后的三个计数，客户端据此重确认',
    drift && drift.details && drift.details.roster_e1_count === CLASS_SIZE - 1
    && drift.details.existing_count === existingBefore
    && drift.details.pending_count === CLASS_SIZE - 1 - existingBefore,
    `实际 ${JSON.stringify(drift && drift.details)}`);
  check('messageFailureText 把 fingerprint_drift 译成「名册刚刚变过」那句',
    /名册/.test(assess.messageFailureText(drift)), assess.messageFailureText(drift));
  if (drift && drift.message === 'fingerprint_drift') {
    note(
      '`fingerprint_drift` 的 `message` 回的是错误码本身，不是中文'
      + '（契约的 `Error.message` 写「中文。文案可随时改」）。',
      '实测回包 `{"code":"fingerprint_drift","message":"fingerprint_drift"}`；'
      + '`server/lib/http.mjs` 的 `MESSAGES` 表里没有这一码，`ApiError` 于是拿 code 兜底。'
      + ' **客户端不咬人** —— §2.4 要求按 `code` 分支、不得字符串匹配 `message`，'
      + ' 本模块的 `messageFailureText` 也是按 code 译的。解封：`MESSAGES` 补一行'
      + '（那张表全系统共用，不是本族的事）。同一码另有 `teacher-book.mjs` 在用。',
    );
  } else {
    // 服务端补上 `MESSAGES` 那一行之后走这一支。**这里不能写 `check(…, true)`** ——
    // 那对任何 message 都成立，等于把上面那条 note 换成一个恒真项（§7.6）。
    check('fingerprint_drift 的 message 是中文，不是错误码本身',
      Boolean(drift) && /[一-鿿]/.test(String(drift.message)),
      `实际 ${JSON.stringify(drift && drift.message)}`);
  }

  // 名册加回来：同一份名册该算回同一个值。
  await quietUpdate('db_child', 'trg_child_touch',
    "UPDATE db_child SET enrollment_status = 'e1' WHERE child_id = $1", [FLIP_CHILD]);
  const restored = await assess.messageBoard();
  check(`名册加回一名（child ${FLIP_CHILD} 改回 e1）之后指纹回到原值`,
    restored.rosterFingerprint === board.rosterFingerprint,
    `${board.rosterFingerprint} → ${restored.rosterFingerprint}`);

  // ── 扇出一次：缺行 INSERT、已有行 skip ────────────────────────────────
  const out = await assess.submitTeacherMessagesForClass({
    content: `  ${CLASS_TEXT}  `, rosterFingerprint: restored.rosterFingerprint,
  });
  const pendingBefore = CLASS_SIZE - existingBefore;
  check(`扇出 inserted_count 是 ${pendingBefore}（缺的那几行）`,
    out.insertedCount === pendingBefore, `实际 ${out.insertedCount}`);
  check(`扇出 skipped_count 是 ${existingBefore}（已有的那几行）`,
    out.skippedCount === existingBefore, `实际 ${out.skippedCount}`);
  check(`扇出之后库里多了正好 ${pendingBefore} 行`,
    await rowCount() === rowsBefore + pendingBefore,
    `${rowsBefore} → ${await rowCount()}`);
  check(`扇出回的 termId 是 ${CURRENT_TERM}`, out.termId === CURRENT_TERM, `实际 ${out.termId}`);

  const all = await db.query(
    `SELECT m.teacher_message_id, m.child_id, m.content, m.teacher_id, m.class_id, m.school_id
       FROM db_teacher_message m WHERE m.term_id = $1 ORDER BY m.child_id`, [CURRENT_TERM]);
  for (const r of all.rows) made.push(r.teacher_message_id);
  check(`当前学期一共 ${CLASS_SIZE} 行，正好是 1 班的 e1 名册`,
    all.rows.length === CLASS_SIZE
    && all.rows.map((r) => r.child_id).join(',') === '1,2,3,4,5,6,7,8,9,10',
    all.rows.map((r) => r.child_id).join(','));
  check('扇出落的行 content 都 trim 过，且内容相同（扇出不是批次实体）',
    all.rows.filter((r) => r.child_id !== TARGET_CHILD).every((r) => r.content === CLASS_TEXT),
    JSON.stringify([...new Set(all.rows.map((r) => r.content))]));
  check('扇出落的行四个派生列都是服务端填的',
    all.rows.every((r) => r.teacher_id === TEACHER && r.class_id === CLASS_ID
      && r.school_id === SCHOOL_ID),
    JSON.stringify(all.rows.map((r) => [r.teacher_id, r.class_id, r.school_id])));

  // 【没有 take over】：child 1 那一行是上一组写的，扇出**不许覆写它**。
  const kept = all.rows.find((r) => r.child_id === TARGET_CHILD);
  check(`child ${TARGET_CHILD} 的正文仍是它自己那一段 —— 扇出没有 take over`,
    kept && kept.content === SINGLE_TEXT,
    `实际 ${JSON.stringify(kept && kept.content)}`);

  // 再扇一次：全班都已有行，inserted 0，**仍是成功，不是 409**。
  const second = await assess.messageBoard();
  const THIRD_TEXT = '第三段完全不同的正文。';
  const again = await assess.submitTeacherMessagesForClass({
    content: THIRD_TEXT, rosterFingerprint: second.rosterFingerprint,
  });
  check('全班都已有行时再扇一次：inserted_count 为 0，且不报错',
    again.insertedCount === 0 && again.skippedCount === CLASS_SIZE,
    JSON.stringify(again));
  check('再扇一次之后行数没变（一行都没插）',
    await rowCount() === rowsBefore + pendingBefore, `实际 ${await rowCount()}`);
  const untouched = await scalar(
    'SELECT count(*)::int FROM db_teacher_message WHERE term_id = $1 AND content = $2',
    [CURRENT_TERM, THIRD_TEXT]);
  check('再扇一次一个字都没覆写（第三段正文在库里 0 行）',
    untouched === 0, `实际 ${untouched} 行`);

  // 看板重画：十行全 c1。
  const after = await assess.messageBoard();
  check('扇出之后看板十行全「已完成」',
    after.rows.length === CLASS_SIZE && after.rows.every((r) => r.done === true),
    JSON.stringify(after.summary));
  check(`扇出之后 summary 是 ${CLASS_SIZE}/${CLASS_SIZE}，undone 为 0`,
    after.summary.done === CLASS_SIZE && after.summary.undone === 0,
    JSON.stringify(after.summary));
  check('已完成那几行的 statusLabel 是「已完成」',
    after.rows.every((r) => r.statusLabel === '已完成'),
    [...new Set(after.rows.map((r) => r.statusLabel))].join(','));

  // 上学期那 60 行一行都没被动过 —— 学期由服务端派生，写不到别的学期去。
  const prev = await scalar(
    'SELECT count(*)::int FROM db_teacher_message WHERE term_id = $1', [PREV_TERM]);
  check(`上学期仍是 ${BASE_ROWS} 行，一行都没被动过`, prev === BASE_ROWS, `实际 ${prev} 行`);
}

/* ── 组 4 · 无进行中学期 ────────────────────────────────────────────────── */

/**
 * 把当前学期的 `start_date` 临时推到「今天」之后，服务端的 `currentTerm()` 因此
 * 派生不到进行中学期。**只改一列，跑完还原**。
 *
 * 基准日是服务端进程启动时的 `--today`（数据集是 2026-04-25），进程外改不了；
 * 能改的是学期的边界，两者是同一个比较的两边。
 */
async function groupNoTerm() {
  console.log('\n[noterm] 无进行中学期 —— 读回 200 空态，写回 409');

  const before = await db.query(
    'SELECT start_date FROM db_school_term WHERE school_id = $1 AND term_id = $2',
    [SCHOOL_ID, CURRENT_TERM]);
  const rowsBefore = await rowCount();

  await quietUpdate('db_school_term', 'trg_school_term_touch',
    `UPDATE db_school_term SET start_date = DATE '2026-06-01'
      WHERE school_id = $1 AND term_id = $2`, [SCHOOL_ID, CURRENT_TERM]);
  try {
    // 读端点：**200 空态**，不是 409。这是本端点的专属口径。
    const raw = await api.get('/teacher-messages');
    check('无学期时读端点回 term_id: null',
      raw.term_id === null, `实际 ${JSON.stringify(raw.term_id)}`);
    check('无学期时 roster_fingerprint 为 null',
      raw.roster_fingerprint === null, `实际 ${JSON.stringify(raw.roster_fingerprint)}`);
    check('无学期时 items 为空数组（不是缺席，也不是 null）',
      Array.isArray(raw.items) && raw.items.length === 0, JSON.stringify(raw.items));
    check('无学期时三个计数都是 0',
      raw.roster_e1_count === 0 && raw.existing_count === 0 && raw.pending_count === 0,
      JSON.stringify([raw.roster_e1_count, raw.existing_count, raw.pending_count]));

    const board = await assess.messageBoard();
    check('service 把空态译成 canSubmit=false，页面据此禁用提交',
      board.canSubmit === false && board.rows.length === 0, JSON.stringify(board.summary));

    // 写端点：409 no_active_term，**且零写入**。
    let single = null;
    try {
      await assess.submitTeacherMessage(TARGET_CHILD, { content: '假期里提交。' });
    } catch (err) { single = err; }
    check('无学期时单条提交回 409 no_active_term',
      single && single.code === 'no_active_term',
      `实际 ${single ? single.code : '(竟然成功了)'}`);
    check('messageFailureText 把 no_active_term 译成「不在学期内」那句',
      /学期/.test(assess.messageFailureText(single)), assess.messageFailureText(single));

    let fanout = null;
    try {
      await assess.submitTeacherMessagesForClass({
        content: '假期里全班提交。', rosterFingerprint: 'x',
      });
    } catch (err) { fanout = err; }
    check('无学期时全班扇出回 409 no_active_term',
      fanout && fanout.code === 'no_active_term',
      `实际 ${fanout ? fanout.code : '(竟然成功了)'}`);
    check('两发都零写入：行数一行都没变', await rowCount() === rowsBefore,
      `${rowsBefore} → ${await rowCount()}`);

    // 单条读：无学期时该幼儿本学期不可能有行，回 404 → service 换成 null。
    const got = await assess.getTeacherMessage(TARGET_CHILD);
    check('无学期时单条读回 null（服务端 404）', got === null, JSON.stringify(got));
  } finally {
    await quietUpdate('db_school_term', 'trg_school_term_touch',
      `UPDATE db_school_term SET start_date = $3
        WHERE school_id = $1 AND term_id = $2`,
      [SCHOOL_ID, CURRENT_TERM, before.rows[0].start_date]);
  }
}

/* ── 组 5 · 幂等键（重放不产生第二行）──────────────────────────────────── */

/**
 * `teacher_message.submit` 与 `.submit_class` 的 `Idempotency-Key` 都是 `required`。
 *
 * service 每次调用自己生一把新 UUID，所以**重放测不到 service 那一层** —— 要重放就
 * 得自己指定同一把键。这一组因此直发 `api.put` 并显式带 `idempotencyKey`，测的是
 * 「同键重放回原结果、不产生第二行」这一条服务端保证。
 */
async function groupIdempotency() {
  console.log('\n[idem] 幂等键 —— 同键重放不产生第二行');

  // 借 child 2：上一组扇出已经给它落了一行，所以先删掉自己造的那一行再重做。
  // 直接换一个还没有行的幼儿最干净 —— 但当前学期十行都在了，所以这一组自己造。
  const victim = 2;
  const existing = await tmRow(victim);
  if (existing) {
    await db.query('DELETE FROM db_teacher_message WHERE teacher_message_id = $1',
      [existing.teacher_message_id]);
  }
  const rowsBefore = await rowCount();
  const key = `probe-tm-${Date.now()}`;
  const body = { content: '语桐爱讲故事，新学期继续。' };

  const first = await api.put(`/children/${victim}/teacher-message`, {
    idempotencyKey: key, body,
  });
  const replay = await api.put(`/children/${victim}/teacher-message`, {
    idempotencyKey: key, body,
  });
  const dbRow = await tmRow(victim);
  if (dbRow) made.push(dbRow.teacher_message_id);

  check('同键重放回原来那一行（teacher_message_id 相同）',
    first.teacher_message_id === replay.teacher_message_id,
    `${first.teacher_message_id} vs ${replay.teacher_message_id}`);
  check('同键重放回原来那个 created_at（逐字相同，不是重新 now()）',
    first.created_at === replay.created_at, `${first.created_at} vs ${replay.created_at}`);
  check('同键重放之后库里只多了一行，不是两行',
    await rowCount() === rowsBefore + 1, `${rowsBefore} → ${await rowCount()}`);

  // 同键、异体：§4.3 要回 422，不许静默按首次结果回。
  let reused = null;
  try {
    await api.put(`/children/${victim}/teacher-message`, {
      idempotencyKey: key, body: { content: '换一段正文，同一把键。' },
    });
  } catch (err) { reused = err; }
  check('同键异体回 422 idempotency_key_reused',
    reused && reused.code === 'idempotency_key_reused',
    `实际 ${reused ? reused.code : '(竟然成功了)'}`);
  check('同键异体那一发零写入', await rowCount() === rowsBefore + 1, `实际 ${await rowCount()}`);
}

/* ── 主体 ───────────────────────────────────────────────────────────────── */

const GROUPS = {
  board: groupBoard,
  single: groupSingle,
  class: groupClass,
  noterm: groupNoTerm,
  idem: groupIdempotency,
};

function requestedGroups() {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--group='));
  if (!arg) return Object.keys(GROUPS);
  const names = arg.slice('--group='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !GROUPS[n]);
  if (unknown.length) {
    console.error(`没有这个组：${unknown.join(', ')}。可选：${Object.keys(GROUPS).join(', ')}`);
    process.exit(2);
  }
  return names;
}

/** 跑之前先确认库是干净的：残渣会让下面每一条计数断言都变成噪音。 */
async function baseline() {
  const total = await rowCount();
  check(`db_teacher_message 的基线是 ${BASE_ROWS} 行`, total === BASE_ROWS, `实际 ${total} 行`);
  const cur = await scalar(
    'SELECT count(*)::int FROM db_teacher_message WHERE term_id = $1', [CURRENT_TERM]);
  check(`当前学期 ${CURRENT_TERM} 的基线是 0 行（${BASE_ROWS} 行全在 ${PREV_TERM}）`,
    cur === 0, `实际 ${cur} 行`);
  const e1 = await scalar(
    "SELECT count(*)::int FROM db_child WHERE class_id = $1 AND enrollment_status = 'e1'",
    [CLASS_ID]);
  check(`1 班的 e1 名册是 ${CLASS_SIZE} 名`, e1 === CLASS_SIZE, `实际 ${e1} 名`);
}

async function main() {
  await db.connect();
  await baseline();

  const ctx = await guard.requireSession();
  check('登录后角色是 teacher', ctx.role === 'teacher', `实际 ${ctx.role}`);
  check(`会话的 scope 是 class ${CLASS_ID}`,
    ctx.scope && ctx.scope.class_id === CLASS_ID, JSON.stringify(ctx.scope));
  check(`会话的当前学期是 ${CURRENT_TERM}`,
    ctx.current_term && ctx.current_term.term_id === CURRENT_TERM,
    JSON.stringify(ctx.current_term));

  // 【契约里没有改写、撤回或删除】—— service 也不许有那三个函数
  // （F16 第二点 / docs/DO-NOT-BUILD.md 第 16 条）。这一条挡的是「以后有人手滑加一个」。
  const banned = Object.keys(assess).filter(
    (k) => /Message/.test(k) && /(edit|update|revoke|withdraw|delete|remove|patch)/i.test(k));
  check('service 里没有任何寄语的编辑／撤回／删除函数',
    banned.length === 0, `出现了 ${banned.join(', ')}`);

  for (const name of requestedGroups()) {
    await GROUPS[name]();
  }
}

/**
 * 逐条删掉本探针建的行，再核对三张表。
 *
 * `db_teacher_message` 只删自己建的那几行，**不按学期整批删** —— 整批删会把
 * 「探针漏了一行」和「数据集本来就没有」抹成同一件事，而下一支探针会替它背锅。
 *
 * 另外两张表（`db_child`／`db_school_term`）由各组自己的 `finally` 还原；这里
 * **再核一遍它们逐列回到基线**。行数对不代表值对。
 */
async function cleanup() {
  const unique = [...new Set(made)];
  for (const id of unique) {
    await db.query('DELETE FROM db_teacher_message WHERE teacher_message_id = $1', [id]);
  }
  // 序列回退，让下一次灌库不出现空洞。
  await db.query(
    "SELECT setval('db_teacher_message_teacher_message_id_seq',"
    + ' (SELECT max(teacher_message_id) FROM db_teacher_message))');

  const total = await rowCount();
  console.log(`\n清理后：db_teacher_message ${total} 行（删掉 ${unique.length} 行）`);
  check(`db_teacher_message 的行数回到基线 ${BASE_ROWS}`, total === BASE_ROWS, `实际 ${total} 行`);

  const cur = await scalar(
    'SELECT count(*)::int FROM db_teacher_message WHERE term_id = $1', [CURRENT_TERM]);
  check(`当前学期回到 0 行`, cur === 0, `实际 ${cur} 行`);
  const prev = await scalar(
    'SELECT count(*)::int FROM db_teacher_message WHERE term_id = $1', [PREV_TERM]);
  check(`上学期仍是 ${BASE_ROWS} 行（本探针一行都没动它）`, prev === BASE_ROWS, `实际 ${prev} 行`);
  const seq = await scalar("SELECT last_value FROM db_teacher_message_teacher_message_id_seq");
  check(`序列回到 ${BASE_ROWS}`, Number(seq) === BASE_ROWS, `实际 ${seq}`);

  // 借用的两张表逐列核回基线，含 `updated_at`（quietUpdate 让它一动都没动）。
  const child = await db.query(
    `SELECT enrollment_status,
            to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS touched
       FROM db_child WHERE child_id = $1`, [FLIP_CHILD]);
  check(`child ${FLIP_CHILD} 的 enrollment_status 回到 e1`,
    child.rows[0].enrollment_status === 'e1', `实际 ${child.rows[0].enrollment_status}`);
  check(`child ${FLIP_CHILD} 的 updated_at 仍是 2023-09-01 09:00:00（触发器没被惊动）`,
    child.rows[0].touched === '2023-09-01 09:00:00', `实际 ${child.rows[0].touched}`);

  const term = await db.query(
    `SELECT to_char(start_date, 'YYYY-MM-DD') AS start_text,
            to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS touched
       FROM db_school_term WHERE school_id = $1 AND term_id = $2`, [SCHOOL_ID, CURRENT_TERM]);
  check(`${CURRENT_TERM} 的 start_date 回到 2026-02-23`,
    term.rows[0].start_text === '2026-02-23', `实际 ${term.rows[0].start_text}`);
  check(`${CURRENT_TERM} 的 updated_at 仍是 2026-02-03 09:00:00（触发器没被惊动）`,
    term.rows[0].touched === '2026-02-03 09:00:00', `实际 ${term.rows[0].touched}`);

  // 触发器一定要重新启用 —— quietUpdate 的 finally 已经做了，这里核一次。
  const disabled = await db.query(
    `SELECT tgname FROM pg_trigger
      WHERE tgrelid IN ('db_child'::regclass, 'db_school_term'::regclass)
        AND NOT tgisinternal AND tgenabled = 'D'`);
  check('两张借用表的 touch 触发器都还是启用状态',
    disabled.rows.length === 0, `还禁着 ${disabled.rows.map((r) => r.tgname).join(',')}`);
}

// 带超时：死锁要红，不要挂住（与 probe-session 同一条理由）。
const timer = setTimeout(() => {
  console.error('探针超时（90s）—— 大概是死锁，不是慢。');
  process.exit(1);
}, 90_000);
timer.unref();

main()
  .catch((err) => check(`探针本身出错：${err && err.stack ? err.stack : err}`, false))
  // 清理无论主体成败都跑：主体半途炸掉时，已经改过的行更需要被还原。
  .then(async () => {
    try {
      await cleanup();
    } catch (err) {
      check(`清理失败，数据库可能残留了改动：${err.message}`, false);
    }
    await db.end().catch(() => {});
    clearTimeout(timer);
    sb.report();
  });
