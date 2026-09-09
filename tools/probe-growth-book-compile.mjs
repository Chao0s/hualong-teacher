/**
 * 编册取回、全班预检、锁定与逐册定稿的探针。**会改数据库，跑完自己收拾。**
 *
 *   `POST /teacher/growth-book/compilation`                        取回或建立本班本学期的编册
 *   `GET  /teacher/growth-book/precheck`                           全班预检（零写入）
 *   `POST /teacher/growth-book/sections/{section_id}/reminders`    提醒家长补交（建 n4），幂等键必填
 *   `POST /teacher/growth-book/compilation/{compilation_id}/lock`  锁定编册（e1→e2，单向）
 *   `POST /teacher/growth-book/books`                              建册（幂等，NONE→b1）
 *   `POST /teacher/growth-book/books/{growth_book_id}/publication` 逐册定稿（b1→b2），建 n5
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 是原样的，
 * `Idempotency-Key` 这颗头也是它按 §1.4 拼的。所以路径写错、头没带出去都会红。
 *
 * ── 为什么另起一支，不并进 `probe-growth-book.mjs` ─────────────────────────
 *
 * 两支的**收拾面**不同，这是唯一的、也是足够的理由：那一支建的行落在
 * `db_moment`／`db_growth_material`／`db_growth_book_time_topic`，本支落在
 * `db_notification`／`db_growth_book`／`db_growth_book_compilation`。混在一起，
 * 一支中途炸掉会连累另一支的基线核对。`tools/probe-*.mjs` 一支一题，也是本仓库
 * 现有 13 支的组织方式（CLAUDE.md §6）。
 *
 * 本支**走的是发布代码**：编册、锁定、建册与定稿都经
 * `miniprogram/services/growth-book.js`，幂等键由 `utils/request.js` 按
 * `api/action-registry.tsv` 自己补。三处例外直接打 `utils/request.js`：
 * 「不带幂等键」「同键重放」「同键异体」——那三条要控制键本身，service 不暴露它。
 *
 * ── 这一组要钉的东西 ───────────────────────────────────────────────────────
 *
 *   取回不是建立      两发 `POST /compilation` 都回 **200**（契约的「已存在，回既有编册」）
 *                     且 `compilation_id` 逐字相同，`db_growth_book_compilation` **一行不增**，
 *                     并且那一行的 `updated_at` 与 `revision` 一点没动 ——
 *                     「回既有那一份」必须是一次读，不是一次悄悄的 UPDATE
 *                     （§7.5：不可逆动作只测状态码等于没测）
 *   预检一名幼儿一行  `children` 的长度等于**库里本班 `enrollment_status='e1'` 的人数**，
 *                     id 逐个相同。期望值从库里算出来，不写死 10 ——
 *                     大一班 10 名全 `e1`，大六班 10 名里有一名 `e2`、一名 `e3`，
 *                     两个班各跑一次，只有过滤真的存在时两边才同时成立（§7.4 两头钉）
 *   齐备判定只数勾选的  §4 规则 95 逐字：「未勾选栏目不进入 manifest、TOC、页数与
 *                     **齐备判定**」。期望值因此**按服务端同一条规则从库里算出来** ——
 *                     只数 `compilation.enabled_sections` 里勾选了的班级栏目。
 *                     再钉反面那一头：大一班本学期的 section 2 有 2 个 `collected` 槽位、
 *                     7 名幼儿没交齐，但它**不在** compilation 2 的 `["time","task"]` 里，
 *                     所以回包里**一条** `section_key='2'` 的 problem 都不许有。
 *                     这一条就是漏掉过滤时会红的那一条（§7.4 两头钉）
 *   预检带指纹        `content_fingerprint` 是非空字符串，同一份数据连取两次相同，
 *                     换一个班不同；`total_pages`／`section_pages` **不在回包里**
 *                     （`db/GAPS.md` G93：0/12 版式包 released，产不出来就不编）
 *   提醒只发给名单上的  `/reminders` 的 `child_ids` 是范围（登记表 `section.remind` 的
 *                     `child_scope_inline`）。**送真子集**：全班有 7 名未交齐，只送 1 名，
 *                     然后两头都钉 —— 建出来的行数等于这 1 名的 caretaker 数
 *                     （不是 7 名的），且收件人逐个核对，别人一个都不在里面。
 *                     送全份的话，「按名单发」与「按全班发」建出来的行数一模一样，
 *                     这个探针**结构上看不出分别**（§7.4）
 *   回包的键照契约      `{notified_child_count, notification_count}` 两格都在，
 *                     且两个数分别等于送进去的人数与库里数出来的 caretaker 数
 *   幂等键必填        不带 `Idempotency-Key` 打 `/reminders` 回 **422**，
 *                     且 `db_notification` 一行不增
 *   重放不重写        同键第二发回**逐字相同的响应体**，`db_notification` 的行数
 *                     与最大 id **都不动**
 *   同键异体          同一把键换一个请求体回 **422 `idempotency_key_reused`**，
 *                     且仍然一行不增（§4.3）
 *   新键要再发一轮    规则 99 明写「教师再次明确点击可以产生新一轮通知」——
 *                     幂等键管的是重发，不是「不准再提醒一次」
 *
 * ── 锁定与定稿这两个不可逆动作，钉的是行，不是状态码（§7.5） ────────────────
 *
 *   建册是取回不是建立  `db_growth_book` 已有本学期这一行时两发都回同一个
 *                     `growth_book_id`，**行数一行不增**
 *   没锁不许定稿      e1 时打 `/publication` 被拒，且 `db_growth_book` 与
 *                     `db_notification` **都一行不动**（依赖链是服务端判的）
 *   锁定真的落库      `compilation_status` 由 `e1` 变 `e2`，`locked_at` 由 NULL 变非空，
 *                     `locked_by` 等于当前教师
 *   锁两次不动行      再锁一发被拒，且 `locked_at` **逐字不变** ——
 *                     一个回 409 却真的又盖了一次时间戳的实作，只看状态码看不出来
 *   指纹不符零写入    带一个假指纹去定稿回 409，`db_growth_book` 与 `db_notification`
 *                     都不动
 *   定稿的通知扇出    b2 那一发建出来的 `n5` 行数**等于这名幼儿当下的 caretaker 数**，
 *                     数目从库里 `jsonb_array_elements(caretakers)` 算出来，不写死
 *   同键重放不重发    同一把幂等键再打一次，回包逐字相同，`db_notification` 的行数与
 *                     最大 id 都不动
 *   **定稿两次不许翻倍**  换一把新键再打一次，被拒，`n5` 行数不变、`book_status` 仍是
 *                     `b2`、`published_at` 逐字不变。这一条是本支的要害：
 *                     b1→b2 是单向的，第二发必须什么都不写
 *
 * 本探针建的行只有 `db_notification`（`/reminders` 的 n4 与定稿的 n5），跑完按
 * `owner_object` 与本次的 id 区间逐行删掉；改过的两行（编册退回 `e1`、那一本退回 `b1`）
 * 逐列写回，核对行数回 `STATS.md`。
 *
 * **两处 `updated_at` 收不回来**：`trg_gbc_touch` 与 `trg_gb_touch` 在 UPDATE 时
 * 无条件盖 `CURRENT_TIMESTAMP`，写回也会被再盖一次。行数、状态与 `published_at`／
 * `locked_at` 全部回到原值，只有这两个时间戳往前走。
 *
 *   node tools/probe-growth-book-compile.mjs
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
const bookApi = require_(resolve(MP, 'services', 'growth-book.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const auth = require_(resolve(MP, 'utils', 'auth.js'));
const session = require_(resolve(MP, 'utils', 'session.js'));
const config = require_(resolve(MP, 'config.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

// ── 状态码要看得见 ──────────────────────────────────────────────────────────
//
// `utils/request.js` 成功时只回响应体，不回状态码（§2.1：资源直接在顶层）。
// 但本轮修的那一条漂移**就是一个状态码**：本班本学期已有编册时要回 200
// 「已存在，回既有编册」，不是 201，也不是原来那个 409。只钉 `compilation_id`
// 的话，一个回 201 却带着既有那一行的实作照样报绿 —— 那正是 §7.5 说的
// 「只测状态码不够」的反面：这一条只有状态码测得出来。
//
// 所以在**平台桩**这一层记一笔，不改 `utils/request.js`：桩之上的每一层仍是
// 原样加载的发布代码。重试会各记一笔，`lastStatus()` 取的是最后落地的那一发。
//
// 同一处也记下这一发带出去的 `Idempotency-Key`。**不是为了检查它** —— 而是
// 「同键重放」那一条要拿服务端已经见过的那把键再打一次，而键是 `utils/request.js`
// 按登记表自己生成的，service 不暴露它。从桩这一层读，比让 service 多一个参数好：
// 多的那个参数只有探针会用。
const wire = [];
const rawRequest = wx.request;
wx.request = (opts) => rawRequest({
  ...opts,
  success: (res) => {
    wire.push({
      url: opts.url,
      method: opts.method,
      status: res.statusCode,
      key: (opts.header || {})['Idempotency-Key'] || null,
    });
    opts.success(res);
  },
});
const lastStatus = () => (wire.length ? wire[wire.length - 1].status : null);
const lastKey = () => (wire.length ? wire[wire.length - 1].key : null);

const db = new Client(DB_URL);

// config.js 的 devSubjectId 是 1：陈静，大一班（class 1），school 1。
// 服务端基准日 2026-04-25 落在 2025-2026-2（2026-02-23…2026-07-10），
// 所以本班本学期的编册是 compilation 2（`e1`），它下面的班级栏目是 section 2（`d2`／`c2`）。
const ME = { teacher_id: 1, class_id: 1 };
const TERM = '2025-2026-2';
const MY_COMPILATION = 2;
const MY_SECTION = 2;

// 大六班那位。班里 10 名幼儿中有一名 `e2`（离园）、一名 `e3`（暂停），
// 所以「只回在园的」这条过滤在这个班上看得见，在大一班上看不见。
const MIXED = { teacher_id: 11, class_id: 6 };

// 定稿钉在这名幼儿身上：大一班的 child 1，本学期已有一本 `b1`（growth_book 11）。
const MY_CHILD = 1;

// STATS.md 的基线。跑完必须回到这三个数。
const BASE_NOTIFICATIONS = 1203;
const BASE_COMPILATIONS = 12;
const BASE_BOOKS = 120;

/** 本次 `/reminders` 建出来的 n4 都在这个 id 之后，收尾按它删。 */
let mineFrom = null;

/** 本次定稿建出来的 n5 都在这个 id 之后，收尾按它删。 */
let bookNotesFrom = null;

/** 本次定稿改到 b2 的那一本，收尾写回 b1。null 表示一发都没成功。 */
let publishedBookId = null;

/** 本次锁到 e2 的那一份编册，收尾写回 e1。null 表示没锁成。 */
let lockedCompilationId = null;

const PATHS = {
  compilation: '/teacher/growth-book/compilation',
  precheck: '/teacher/growth-book/precheck',
  reminders: `/teacher/growth-book/sections/${MY_SECTION}/reminders`,
};

async function counts() {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM db_notification) AS notifications,
            (SELECT count(*)::int FROM db_growth_book_compilation) AS compilations,
            (SELECT count(*)::int FROM db_growth_book) AS books,
            (SELECT COALESCE(max(notification_id), 0) FROM db_notification) AS max_notification`,
  );
  return r.rows[0];
}

/** 一本册子的库内原貌。`published_at` 取到秒，用来证明第二发什么都没写。 */
async function bookRow(childId, termId) {
  const r = await db.query(
    `SELECT growth_book_id, child_id, book_status,
            COALESCE(to_char(published_at, 'YYYY-MM-DD HH24:MI:SS'), '') AS published_label
       FROM db_growth_book WHERE child_id = $1 AND term_id = $2`,
    [childId, termId],
  );
  return r.rows[0] || null;
}

/** 编册那一行的锁。`locked_at` 取到秒，用来证明第二发没有再盖一次时间戳。 */
async function lockRow(compilationId) {
  const r = await db.query(
    `SELECT compilation_status, locked_by,
            COALESCE(to_char(locked_at, 'YYYY-MM-DD HH24:MI:SS'), '') AS locked_label
       FROM db_growth_book_compilation WHERE compilation_id = $1`,
    [compilationId],
  );
  return r.rows[0] || null;
}

/** 这名幼儿**当下**有几名 caretaker。定稿的 n5 一名一笔（§4 规则 89）。 */
async function caretakerCount(childId) {
  const r = await db.query(
    `SELECT count(*)::int AS n
       FROM db_child ch, jsonb_array_elements(ch.caretakers) e
      WHERE ch.child_id = $1`,
    [childId],
  );
  return r.rows[0].n;
}

/** 编册那一行的库内原貌。`updated_at` 取到秒，用来证明「回既有那一份」没写。 */
async function compilationRow(classId, termId) {
  const r = await db.query(
    `SELECT compilation_id, class_id, term_id, compilation_status, revision,
            to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_label
       FROM db_growth_book_compilation WHERE class_id = $1 AND term_id = $2`,
    [classId, termId],
  );
  return r.rows[0] || null;
}

/** 本班在园幼儿的 id，升序。**期望值从库里来，不写死一串数。** */
async function enrolledIds(classId) {
  const r = await db.query(
    "SELECT child_id FROM db_child WHERE class_id = $1 AND enrollment_status = 'e1' ORDER BY child_id",
    [classId],
  );
  return r.rows.map((x) => x.child_id);
}

/** 本班全部幼儿的 id（含离园与暂停）。两个数不同，过滤才验得出来。 */
async function allChildIds(classId) {
  const r = await db.query(
    'SELECT child_id FROM db_child WHERE class_id = $1 ORDER BY child_id',
    [classId],
  );
  return r.rows.map((x) => x.child_id);
}

/** 编册那一行的 `enabled_sections`。**服务端的齐备判定按它过滤，期望值也按它算。** */
async function enabledSections(classId, termId) {
  const r = await db.query(
    `SELECT COALESCE(enabled_sections::text, '[]') AS enabled
       FROM db_growth_book_compilation WHERE class_id = $1 AND term_id = $2`,
    [classId, termId],
  );
  return r.rows.length ? JSON.parse(r.rows[0].enabled) : [];
}

/**
 * 某一个班级栏目里「有槽位没交齐」的幼儿，升序。**不看勾选**。
 * 用它钉反面那一头：没勾选的栏目照样有人没交齐，但预检不许因此报 problem。
 */
async function unfilledIn(classId, sectionId) {
  const r = await db.query(
    `SELECT ch.child_id FROM db_child ch
      WHERE ch.class_id = $1 AND ch.enrollment_status = 'e1'
        AND EXISTS (SELECT 1 FROM db_book_widget w
                     WHERE w.section_id = $2 AND w.binding_key = 'collected'
                       AND NOT EXISTS (SELECT 1 FROM db_book_material_submission s
                                        WHERE s.widget_id = w.widget_id AND s.child_id = ch.child_id))
      ORDER BY ch.child_id`,
    [classId, sectionId],
  );
  return r.rows.map((x) => x.child_id);
}

/**
 * 预检**应该**标出来的幼儿，升序。按服务端同一条规则算：本班在园的幼儿 ×
 * 本学期编册里**已勾选**的班级栏目，任一 `collected` 槽位没交齐就算一条。
 * `jsonb_exists` 与服务端那条 SQL 逐字同一个函数；`enabled_sections` 存的是
 * `section_id` 的字符串形式，所以比的是 `s.section_id::text`。
 */
async function expectedFlagged(classId, compilationId) {
  const r = await db.query(
    `SELECT DISTINCT ch.child_id FROM db_child ch
      WHERE ch.class_id = $1 AND ch.enrollment_status = 'e1'
        AND EXISTS (
          SELECT 1 FROM db_growth_book_section s
            JOIN db_growth_book_compilation gbc ON gbc.compilation_id = s.compilation_id
            JOIN db_book_widget w ON w.section_id = s.section_id AND w.binding_key = 'collected'
           WHERE s.compilation_id = $2
             AND jsonb_exists(COALESCE(gbc.enabled_sections, '[]'::jsonb), s.section_id::text)
             AND NOT EXISTS (SELECT 1 FROM db_book_material_submission ms
                              WHERE ms.widget_id = w.widget_id AND ms.child_id = ch.child_id))
      ORDER BY ch.child_id`,
    [classId, compilationId],
  );
  return r.rows.map((x) => x.child_id);
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

/**
 * 断言这一发被拒，**且 `db_notification` 与 `db_growth_book` 都一行不增**（§7.5）。
 *
 * 两张表一起数：拒绝定稿的那几条，错的可能是「通知照发」，也可能是「册子照建」。
 */
async function refuses(label, call, expectCode, expectRule) {
  const before = await counts();
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
  const after = await counts();
  check(`${label} 之后 db_notification 与 db_growth_book 都一行不增`,
    after.notifications === before.notifications
    && after.max_notification === before.max_notification
    && after.books === before.books,
    `通知 ${before.notifications}/${before.max_notification} → `
    + `${after.notifications}/${after.max_notification}；`
    + `册子 ${before.books} → ${after.books}`);
}

async function main() {
  await db.connect();

  const start = await counts();
  console.log(`基线：db_notification=${start.notifications}，`
    + `db_growth_book_compilation=${start.compilations}，`
    + `db_growth_book=${start.books}`);
  check('db_notification 基线与 STATS.md 一致',
    start.notifications === BASE_NOTIFICATIONS, `实际 ${start.notifications}`);
  check('db_growth_book_compilation 基线与 STATS.md 一致',
    start.compilations === BASE_COMPILATIONS, `实际 ${start.compilations}`);
  check('db_growth_book 基线与 STATS.md 一致',
    start.books === BASE_BOOKS, `实际 ${start.books}`);

  await auth.ensureSession();
  check('登录后角色是 teacher', guard.currentRole() === 'teacher', `实际 ${guard.currentRole()}`);

  /* ── 取回不是建立 ────────────────────────────────────────────────────── */

  const seeded = await compilationRow(ME.class_id, TERM);
  check(`数据集里大一班本学期已有一份编册（compilation ${MY_COMPILATION}）`,
    Boolean(seeded) && seeded.compilation_id === MY_COMPILATION, JSON.stringify(seeded));

  const first = await api.post(PATHS.compilation, { body: {} });
  check('第一发 POST /compilation 回 200（契约的「已存在，回既有编册」），不是 201',
    lastStatus() === 200, `实际 ${lastStatus()}`);
  check('第一发 POST /compilation 回的是既有那一份的 compilation_id',
    first && first.compilation_id === MY_COMPILATION, JSON.stringify(first));
  check('回包的 class_id 与 term_id 与库里那一行逐字相同',
    first && first.class_id === seeded.class_id && first.term_id === seeded.term_id,
    JSON.stringify(first));
  check('回包的 compilation_status 与 revision 与库里那一行逐字相同',
    first && first.compilation_status === seeded.compilation_status
    && Number(first.revision) === Number(seeded.revision),
    `回包 ${first && first.compilation_status}/${first && first.revision}，`
    + `库里 ${seeded.compilation_status}/${seeded.revision}`);

  const second = await api.post(PATHS.compilation, { body: {} });
  check('第二发 POST /compilation 也回 200', lastStatus() === 200, `实际 ${lastStatus()}`);
  check('第二发 POST /compilation 回同一个 compilation_id',
    second && second.compilation_id === first.compilation_id,
    `${first && first.compilation_id} → ${second && second.compilation_id}`);

  const afterEnsure = await counts();
  check('两发 POST /compilation 之后 db_growth_book_compilation 一行不增',
    afterEnsure.compilations === start.compilations,
    `${start.compilations} → ${afterEnsure.compilations}`);
  const stillSeeded = await compilationRow(ME.class_id, TERM);
  check('「回既有那一份」是一次读，不是一次 UPDATE（updated_at 与 revision 都没动）',
    stillSeeded.updated_label === seeded.updated_label
    && Number(stillSeeded.revision) === Number(seeded.revision),
    `${seeded.updated_label}/${seeded.revision} → `
    + `${stillSeeded.updated_label}/${stillSeeded.revision}`);

  /* ── 预检：一名在园幼儿一行，带指纹 ──────────────────────────────────── */

  const pre = await api.get(PATHS.precheck);
  check('预检回的是 ClassPrecheck，不是 {items, next_cursor}',
    Boolean(pre) && Array.isArray(pre.children) && pre.items === undefined,
    `实际收到的键：${pre ? Object.keys(pre).join(', ') : '(空)'}`);

  const mineEnrolled = await enrolledIds(ME.class_id);
  const mineAll = await allChildIds(ME.class_id);
  check(`大一班一名在园幼儿一行（库里 ${mineEnrolled.length} 名）`,
    pre.children.length === mineEnrolled.length, `回了 ${pre.children.length} 行`);
  check('大一班回的 child_id 与库里逐个相同、顺序为 child_id ASC',
    pre.children.map((x) => x.child_id).join(',') === mineEnrolled.join(','),
    `回包 ${pre.children.map((x) => x.child_id).join(',')}；库里 ${mineEnrolled.join(',')}`);
  check(`大一班 ${mineAll.length} 名全 e1，所以这个班分不出「有没有过滤」`,
    mineEnrolled.length === mineAll.length,
    `在园 ${mineEnrolled.length}，全班 ${mineAll.length}`);

  check('content_fingerprint 是非空字符串',
    typeof pre.content_fingerprint === 'string' && pre.content_fingerprint.length > 0,
    `实际 ${JSON.stringify(pre.content_fingerprint)}`);
  const again = await api.get(PATHS.precheck);
  check('同一份数据连取两次，content_fingerprint 相同',
    again.content_fingerprint === pre.content_fingerprint,
    `${pre.content_fingerprint} → ${again.content_fingerprint}`);

  // G93：0/12 版式包 released，页数产不出来。**回包里不许出现一个编出来的数。**
  const anyPages = pre.children.some(
    (x) => x.total_pages !== undefined || x.section_pages !== undefined,
  );
  check('回包不带 total_pages／section_pages（G93：产不出来就不编）', !anyPages,
    JSON.stringify(pre.children[0]));

  // 另一头：也不许比契约多回。`ClassPrecheck.children[]` 没有 `growth_book_id` 这一格，
  // 而那一格恰好是跨班漏出来的那一个（`db_growth_book.class_id` 钉的是建册时那个班，
  // 不跟着幼儿转班走）。所以逐个断言键集在契约声明的范围内。
  const DECLARED = new Set([
    'child_id', 'total_pages', 'section_pages', 'problems',
    'publishable', 'blocked_by_class_shared_content', 'book_status',
  ]);
  const extra = [...new Set(pre.children.flatMap((x) => Object.keys(x)))]
    .filter((k) => !DECLARED.has(k));
  check('children[] 没有契约之外的键（`growth_book_id` 不在 ClassPrecheck 里）',
    extra.length === 0, `多出来的键：${extra.join(',')}`);

  // 齐备判定的两头。**期望值按服务端同一条规则算**（规则 95：只数已勾选的栏目）。
  const enabled = await enabledSections(ME.class_id, TERM);
  const expectedProblemChildren = await expectedFlagged(ME.class_id, MY_COMPILATION);
  const flagged = pre.children.filter((x) => x.problems.length > 0).map((x) => x.child_id);
  check('带 problems 的幼儿与库里按规则 95 算出来的那几名逐个相同',
    flagged.join(',') === expectedProblemChildren.join(','),
    `回包 ${flagged.join(',')}；库里 ${expectedProblemChildren.join(',')}`);
  check('problems 的 rule 是 collected_incomplete，section_key 指着一个已勾选的班级栏目',
    pre.children.every((x) => x.problems.every(
      (p) => p.rule === 'collected_incomplete' && enabled.includes(p.section_key),
    )),
    JSON.stringify(pre.children.find((x) => x.problems.length > 0)));

  // ── 规则 95 的反面那一头 ────────────────────────────────────────────────
  //
  // 上面那一条在数据集里两边都是空集，**空对空是过不了关的断言**。所以再钉一条
  // 反面的：section 2 真的有人没交齐（不然下面那一条是空谈），它真的不在
  // compilation 2 的 `enabled_sections` 里，于是回包里一条指着它的 problem 都不许有。
  // 漏掉服务端那条过滤时，红的就是这一条 —— 它会标出 7 名幼儿。
  const unfilled = await unfilledIn(ME.class_id, MY_SECTION);
  check(`section ${MY_SECTION} 不在 compilation ${MY_COMPILATION} 的 enabled_sections 里`,
    !enabled.includes(String(MY_SECTION)), `enabled_sections = ${JSON.stringify(enabled)}`);
  check(`section ${MY_SECTION} 确实有人没交齐（库里 ${unfilled.length} 名），`
    + '所以下面那一条不是空谈',
    unfilled.length > 0, `未交齐的幼儿：${unfilled.join(',')}`);
  const leaked = pre.children.filter(
    (x) => x.problems.some((p) => p.section_key === String(MY_SECTION)),
  ).map((x) => x.child_id);
  check(`未勾选的 section ${MY_SECTION} 一条 problem 都不产生（§4 规则 95：`
    + '未勾选栏目不进入齐备判定）',
    leaked.length === 0, `却标了 ${leaked.length} 名：${leaked.join(',')}`);

  // 范围的另一头：大六班有一名 e2、一名 e3，两个数因此不等。
  await asTeacher(MIXED.teacher_id, async () => {
    const mixedEnrolled = await enrolledIds(MIXED.class_id);
    const mixedAll = await allChildIds(MIXED.class_id);
    check(`大六班全班 ${mixedAll.length} 名、在园 ${mixedEnrolled.length} 名，两个数不等`,
      mixedEnrolled.length < mixedAll.length,
      `在园 ${mixedEnrolled.length}，全班 ${mixedAll.length}`);
    const mixedPre = await api.get(PATHS.precheck);
    check('大六班的预检只回在园那几名，离园与暂停的不在里面',
      mixedPre.children.map((x) => x.child_id).join(',') === mixedEnrolled.join(','),
      `回包 ${mixedPre.children.map((x) => x.child_id).join(',')}；`
      + `在园 ${mixedEnrolled.join(',')}`);
    check('大六班的 content_fingerprint 与大一班不同（指纹绑的是这个班这个学期）',
      mixedPre.content_fingerprint !== pre.content_fingerprint,
      `${pre.content_fingerprint} / ${mixedPre.content_fingerprint}`);
  });

  /* ── 幂等：必填、重放、同键异体、新键 ────────────────────────────────── */

  // `/reminders` 是「提醒没交齐的家长」，与规则 95 的齐备判定不是同一件事：
  // 它按栏目自己数，不看 `enabled_sections`（服务端那个 handler 也一样）。
  // 所以下面这几发取的是 `unfilled`，不是上面那份按规则 95 过滤过的名单。
  await refuses('不带 Idempotency-Key 打 /reminders',
    () => api.post(PATHS.reminders, { body: { child_ids: unfilled } }),
    'validation_failed', 'required');

  // **只送真子集。** 送全份的话，「服务端按 child_ids 发」与「服务端自己数全班未交齐
  // 的人」两种实作会建出一模一样的行数 —— 这个探针**结构上看不出分别**。
  // 客户端那颗按钮是逐行的，一次只送一个 id，所以这里也只送一个，
  // 再钉「建出来的行只属于这一个 id」（§7.4 两头钉：数目对且别人不在里面）。
  const picked = unfilled.slice(0, 1);
  check(`送出去的 child_ids 是真子集（${picked.length} / ${unfilled.length}），`
    + '所以「按名单发」与「按全班发」建出来的行数不同',
    picked.length > 0 && picked.length < unfilled.length,
    `picked=${picked.join(',')}；unfilled=${unfilled.join(',')}`);

  // 库里数两遍：这一份名单该建几行，全班未交齐的人又该建几行。两个数不等，
  // 下面那一条才判得出服务端读没读请求体。
  const caretakerRows = async (ids) => (await db.query(
    `SELECT ch.child_id, e.value->>'id' AS parent_id
       FROM db_child ch, jsonb_array_elements(ch.caretakers) e
      WHERE ch.child_id = ANY($1::int[])
      ORDER BY ch.child_id, (e.value->>'id')::int`,
    [ids],
  )).rows;
  const expectedRows = await caretakerRows(picked);
  const expected = expectedRows.length;
  const fanoutRows = await caretakerRows(unfilled);
  check(`按名单发该建 ${expected} 行，按全班未交齐的人发会建 ${fanoutRows.length} 行，两个数不等`,
    expected > 0 && expected < fanoutRows.length,
    `${expected} / ${fanoutRows.length}`);

  const before = await counts();
  mineFrom = before.max_notification;
  const key = api.uuid();
  const body = { child_ids: picked };
  const one = await api.post(PATHS.reminders, { body, idempotencyKey: key });
  const afterOne = await counts();
  check('第一发 /reminders 真的建了 n4',
    afterOne.notifications > before.notifications,
    `${before.notifications} → ${afterOne.notifications}`);

  check(`建出来的行数等于「送进去的那 ${picked.length} 名幼儿 × 当下 caretaker」`
    + `（库里数得 ${expected}），不是全班未交齐的 ${fanoutRows.length}`,
    afterOne.notifications - before.notifications === expected,
    `实际多了 ${afterOne.notifications - before.notifications}`);

  // 另一头：逐行核对收件人。行数对不代表发对了人 —— 钉到库里的那几行（§7.6）。
  const wrote = (await db.query(
    `SELECT recipient_parent_id::text AS parent_id FROM db_notification
      WHERE notification_id > $1 AND notification_type = 'n4'
        AND owner_object = 'db_growth_book_section' AND owner_id = $2
      ORDER BY recipient_parent_id`,
    [before.max_notification, MY_SECTION],
  )).rows.map((x) => x.parent_id);
  const wantParents = expectedRows.map((x) => String(x.parent_id)).sort();
  check('收件人正好是这几名幼儿当下的监护人，别人一个都不在里面',
    wrote.slice().sort().join(',') === wantParents.join(','),
    `实际 ${wrote.join(',')}；应为 ${wantParents.join(',')}`);

  // 回包的两个键照契约。服务端曾经回 `reminded_count`，客户端读不到，
  // 屏幕上只能写「服务端未回条数」。
  check('回包的键就是契约声明的 {notified_child_count, notification_count}',
    Object.keys(one).sort().join(',') === 'notification_count,notified_child_count',
    `实际收到的键：${Object.keys(one).join(', ')}`);
  // 两个数都从库里算：有监护人的幼儿才算「提醒到了」（规则 99 零 caretaker 合法零通知），
  // 所以幼儿数取 `expectedRows` 里出现过的 child_id，不取送进去的 id 个数。
  const wantChildren = new Set(expectedRows.map((x) => x.child_id)).size;
  check(`notified_child_count = ${wantChildren}、notification_count = ${expected}`,
    one.notified_child_count === wantChildren && one.notification_count === expected,
    JSON.stringify(one));

  const replay = await api.post(PATHS.reminders, { body, idempotencyKey: key });
  check('同键重放回逐字相同的响应体',
    JSON.stringify(replay) === JSON.stringify(one),
    `${JSON.stringify(one)} → ${JSON.stringify(replay)}`);
  const afterReplay = await counts();
  check('同键重放一行都没再写（行数与最大 id 都不动）',
    afterReplay.notifications === afterOne.notifications
    && afterReplay.max_notification === afterOne.max_notification,
    `${afterOne.notifications}/${afterOne.max_notification} → `
    + `${afterReplay.notifications}/${afterReplay.max_notification}`);

  await refuses('同一把键换一个请求体',
    () => api.post(PATHS.reminders, {
      body: { child_ids: unfilled.slice(0, 2) },
      idempotencyKey: key,
    }),
    'idempotency_key_reused', 'same_key_different_request');

  // 换一把新键就该再发一轮（规则 99：幂等键管重发，不管「不准再提醒一次」）。
  const fresh = await api.post(PATHS.reminders, { body, idempotencyKey: api.uuid() });
  const afterFresh = await counts();
  check('换一把新键再发，n4 又多了一轮（规则 99：再次明确点击可以再提醒）',
    afterFresh.notifications - afterReplay.notifications === expected,
    `实际多了 ${afterFresh.notifications - afterReplay.notifications}`);
  check('新键那一发的回包与第一发形状相同',
    JSON.stringify(Object.keys(fresh)) === JSON.stringify(Object.keys(one)),
    `${JSON.stringify(fresh)} / ${JSON.stringify(one)}`);

  /* ── 建册：取回不是建立 ──────────────────────────────────────────────── */
  //
  // 数据集里大一班本学期十名幼儿各已有一本 `b1`（growth_book 11…20），
  // 所以这里走得到的是 200「已存在」那一条。**201 那一条这份数据集里到不了**，
  // 现测现记，不假装测过。
  const seededBook = await bookRow(MY_CHILD, TERM);
  check(`数据集里 child ${MY_CHILD} 本学期已有一本 b1`,
    Boolean(seededBook) && seededBook.book_status === 'b1', JSON.stringify(seededBook));

  const beforeEnsureBook = await counts();
  const book1 = await bookApi.ensureBook(MY_CHILD);
  check('第一发 POST /books 回 200（契约的「已存在」），不是 201',
    lastStatus() === 200, `实际 ${lastStatus()}`);
  check('回的是既有那一本的 growth_book_id',
    book1.id === seededBook.growth_book_id,
    `回包 ${book1.id}，库里 ${seededBook.growth_book_id}`);
  const book2 = await bookApi.ensureBook(MY_CHILD);
  check('第二发 POST /books 回同一个 growth_book_id',
    book2.id === book1.id, `${book1.id} → ${book2.id}`);
  const afterEnsureBook = await counts();
  check('两发 POST /books 之后 db_growth_book 一行不增',
    afterEnsureBook.books === beforeEnsureBook.books,
    `${beforeEnsureBook.books} → ${afterEnsureBook.books}`);
  note('POST /books 的 201「已建册」这一条本数据集到不了：'
    + '大一班十名幼儿本学期各已有一本', `child ${MY_CHILD} 走的是 200`);

  /* ── 依赖链：没锁不许定稿 ────────────────────────────────────────────── */
  //
  // 建册**会改指纹**（服务端的 `contentFingerprint` 把 `db_growth_book` 的
  // `book_release_id` 与 `pack_code` 算进去），所以指纹在建册之后才取。
  const pre2 = await bookApi.precheck();
  check('建册之后再取的预检仍带指纹',
    typeof pre2.fingerprint === 'string' && pre2.fingerprint.length > 0,
    JSON.stringify(pre2.fingerprint));

  const stillE1 = await lockRow(MY_COMPILATION);
  check(`定稿之前编册仍是 e1（compilation ${MY_COMPILATION}）`,
    stillE1.compilation_status === 'e1', JSON.stringify(stillE1));
  await refuses('编册还是 e1 时打 /publication',
    () => bookApi.publishBook(book1.id, pre2.fingerprint),
    'not_found');

  /* ── 锁定：e1→e2 单向，锁两次不动行 ──────────────────────────────────── */

  const comp = await bookApi.ensureCompilation();

  // **勾选清单钉到库里那一行，不钉回包的形状**（CLAUDE.md §7.6）。
  // 这条路径上没有 GET，`POST /compilation` 就是客户端读「本学期勾了哪几个栏目」的
  // 唯一出口。回包少这一格时客户端读回来的是空勾选，而编册页下一次点开关就会拿
  // 那份空勾选把库里的覆盖掉 —— 一次点击丢掉一个栏目，只看回包的键有没有是看不出来的。
  const enabledRow = await enabledSections(ME.class_id, TERM);
  check('ensureCompilation() 回的 enabled_sections 与库里那一行逐个相同',
    comp.enabled.join(',') === enabledRow.map(String).join(','),
    `回包 ${JSON.stringify(comp.enabled)}；库里 ${JSON.stringify(enabledRow)}`);

  // **范围先钉住，再往下走**（红线 1）。锁定与建册都是内联 predicate 的写入，
  // 而「内联了没有」只有换一位教师才看得出来：教师 11 带的是大六班，
  // 拿大一班的 compilation_id 与大一班的 child_id 去打这两条，两条都必须 404
  // 且一行不写。这两发跑在锁定之前，因为那时大一班这一份还是 e1 ——
  // 少了 `class_id` 那一条，这一发会**真的把别班的编册锁上**，
  // 而锁定是单向的，只看状态码事后看不出来。
  await asTeacher(MIXED.teacher_id, async () => {
    await refuses(`大六班的教师拿 compilation ${MY_COMPILATION} 打 /lock`,
      () => bookApi.lockCompilation(MY_COMPILATION, comp.revision),
      'not_found');
    await refuses(`大六班的教师拿大一班的 child ${MY_CHILD} 打 POST /books`,
      () => bookApi.ensureBook(MY_CHILD),
      'not_found');
  });
  const acrossClass = await lockRow(MY_COMPILATION);
  check('别班教师那一发之后，大一班的编册仍是 e1、locked_at 仍空',
    acrossClass.compilation_status === 'e1' && acrossClass.locked_label === '',
    JSON.stringify(acrossClass));

  const locked = await bookApi.lockCompilation(comp.id, comp.revision);
  lockedCompilationId = comp.id;
  check('锁定回 200', lastStatus() === 200, `实际 ${lastStatus()}`);
  check('回包的 compilation_status 是 e2', locked.status === 'e2', JSON.stringify(locked));

  const lockedRow = await lockRow(MY_COMPILATION);
  check('库里那一行真的变成 e2', lockedRow.compilation_status === 'e2',
    JSON.stringify(lockedRow));
  check('locked_at 由 NULL 变成非空', lockedRow.locked_label !== '',
    `实际「${lockedRow.locked_label}」`);
  check(`locked_by 是当前教师（${ME.teacher_id}）`,
    Number(lockedRow.locked_by) === ME.teacher_id, `实际 ${lockedRow.locked_by}`);

  // 再锁一发：单向，第二发必须什么都不写。**只看状态码看不出「又盖了一次时间戳」。**
  await refuses('已经 e2 之后再锁一发',
    () => bookApi.lockCompilation(comp.id, comp.revision),
    'not_found');
  const lockedAgain = await lockRow(MY_COMPILATION);
  check('第二发锁定没有再盖一次 locked_at，locked_by 也没换人',
    lockedAgain.locked_label === lockedRow.locked_label
    && String(lockedAgain.locked_by) === String(lockedRow.locked_by),
    `${lockedRow.locked_label}/${lockedRow.locked_by} → `
    + `${lockedAgain.locked_label}/${lockedAgain.locked_by}`);

  /* ── 定稿：范围、指纹、扇出、重放、第二发 ────────────────────────────── */

  // 范围这一条要在**其余前置全部满足之后**打，才钉得住：这时大一班已经 e2、
  // 那一本还是 b1、指纹也是刚取的，唯一挡得住别班教师的就是那条内联的 `class_id`。
  // 少了它，别班的教师就能替大一班定稿，并向大一班幼儿的监护人发出 `n5`。
  await asTeacher(MIXED.teacher_id, async () => {
    await refuses(`大六班的教师拿大一班的 growth_book ${book1.id} 打 /publication`,
      () => bookApi.publishBook(book1.id, pre2.fingerprint),
      'not_found');
  });
  const notPublished = await bookRow(MY_CHILD, TERM);
  check('别班教师那一发之后，大一班那一本仍是 b1、published_at 仍空',
    notPublished.book_status === 'b1' && notPublished.published_label === '',
    JSON.stringify(notPublished));

  await refuses('带一个假指纹去定稿',
    () => bookApi.publishBook(book1.id, 'not-the-real-fingerprint'),
    'fingerprint_drift', 'recomputed_differs');

  const caretakers = await caretakerCount(MY_CHILD);
  check(`child ${MY_CHILD} 当下有 caretaker，所以扇出那一条不是空谈`,
    caretakers > 0, `实际 ${caretakers} 名`);

  const beforePublish = await counts();
  bookNotesFrom = beforePublish.max_notification;
  const published = await bookApi.publishBook(book1.id, pre2.fingerprint);
  publishedBookId = book1.id;
  const publishKey = lastKey();
  check('定稿回 200', lastStatus() === 200, `实际 ${lastStatus()}`);
  check('回包的 book_status 是 b2', published.status === 'b2', JSON.stringify(published));
  check('service 那一发自己带了 Idempotency-Key（登记表 book.publish 是 required）',
    Boolean(publishKey), `实际 ${publishKey}`);

  const b2Row = await bookRow(MY_CHILD, TERM);
  check('库里那一本真的变成 b2', b2Row.book_status === 'b2', JSON.stringify(b2Row));
  check('published_at 由 NULL 变成非空', b2Row.published_label !== '',
    `实际「${b2Row.published_label}」`);

  const afterPublish = await counts();
  check(`定稿建出来的 n5 行数等于这名幼儿当下的 caretaker 数（库里数得 ${caretakers}）`,
    afterPublish.notifications - beforePublish.notifications === caretakers,
    `实际多了 ${afterPublish.notifications - beforePublish.notifications}`);
  const n5 = (await db.query(
    `SELECT count(*)::int AS n FROM db_notification
      WHERE notification_id > $1 AND owner_object = 'db_growth_book' AND owner_id = $2
        AND notification_type = 'n5' AND recipient_type = 'r2'`,
    [bookNotesFrom, book1.id],
  )).rows[0].n;
  check(`这 ${caretakers} 行的 owner 指着这一本、类型是 n5、收件人是家长`,
    n5 === caretakers, `实际 ${n5} 行`);

  // 同键重放：回包逐字相同，一行都不再写（§4.2）。
  const replayPub = await api.post(
    `/teacher/growth-book/books/${book1.id}/publication`,
    { body: { content_fingerprint: pre2.fingerprint }, idempotencyKey: publishKey },
  );
  const afterReplayPub = await counts();
  // 逐字比三格：service 那一层把回包解码过了，所以拿解码后的三个值回头比裸回包。
  check('同键重放定稿回同一本、同一个状态、同一个 published_at',
    replayPub.growth_book_id === published.id
    && replayPub.book_status === published.status
    && replayPub.published_at === published.publishedAt,
    `${JSON.stringify(replayPub)} / ${published.id}/${published.status}/${published.publishedAt}`);
  check('同键重放定稿一行都没再写',
    afterReplayPub.notifications === afterPublish.notifications
    && afterReplayPub.max_notification === afterPublish.max_notification,
    `${afterPublish.notifications}/${afterPublish.max_notification} → `
    + `${afterReplayPub.notifications}/${afterReplayPub.max_notification}`);

  // **要害**：换一把新键再定稿一次，b1→b2 是单向的，第二发必须什么都不写。
  await refuses('已经 b2 之后换一把新键再定稿一次',
    () => bookApi.publishBook(book1.id, pre2.fingerprint),
    'not_found');
  const afterSecond = await counts();
  check('定稿两次没有把 n5 翻倍',
    afterSecond.notifications === afterPublish.notifications,
    `第一发后 ${afterPublish.notifications}，第二发后 ${afterSecond.notifications}`);
  const b2Again = await bookRow(MY_CHILD, TERM);
  check('第二发定稿没有改 book_status，也没有再盖一次 published_at',
    b2Again.book_status === 'b2' && b2Again.published_label === b2Row.published_label,
    `${b2Row.book_status}/${b2Row.published_label} → `
    + `${b2Again.book_status}/${b2Again.published_label}`);
}

/**
 * 收拾。三件事，顺序不能反 —— 先删通知，再退状态：
 *
 *   1. `/reminders` 建的 n4 与定稿建的 n5，各按本次的 id 区间与 `owner_object` 删掉；
 *   2. 定稿改到 `b2` 的那一本写回 `b1`、`published_at` 写回 NULL；
 *   3. 锁到 `e2` 的那一份编册写回 `e1`、`locked_at` 与 `locked_by` 写回 NULL。
 *
 * **两处 `updated_at` 收不回来**：`trg_gb_touch` 与 `trg_gbc_touch` 在 UPDATE 时
 * 无条件盖 `CURRENT_TIMESTAMP`。行数、状态与两个业务时间戳都回到原值。
 */
async function cleanup() {
  if (mineFrom !== null) {
    await db.query(
      `DELETE FROM db_notification
        WHERE notification_id > $1
          AND owner_object = 'db_growth_book_section' AND owner_id = $2`,
      [mineFrom, MY_SECTION],
    );
  }
  if (bookNotesFrom !== null && publishedBookId !== null) {
    await db.query(
      `DELETE FROM db_notification
        WHERE notification_id > $1
          AND owner_object = 'db_growth_book' AND owner_id = $2`,
      [bookNotesFrom, publishedBookId],
    );
  }
  if (publishedBookId !== null) {
    await db.query(
      "UPDATE db_growth_book SET book_status = 'b1', published_at = NULL WHERE growth_book_id = $1",
      [publishedBookId],
    );
  }
  if (lockedCompilationId !== null) {
    await db.query(
      `UPDATE db_growth_book_compilation
          SET compilation_status = 'e1', locked_at = NULL, locked_by = NULL
        WHERE compilation_id = $1`,
      [lockedCompilationId],
    );
  }
  const end = await counts();
  check(`逐表行数回到 STATS.md 的基线（db_notification=${BASE_NOTIFICATIONS}，`
    + `db_growth_book_compilation=${BASE_COMPILATIONS}，db_growth_book=${BASE_BOOKS}）`,
    end.notifications === BASE_NOTIFICATIONS
    && end.compilations === BASE_COMPILATIONS
    && end.books === BASE_BOOKS,
    JSON.stringify(end));
  const backE1 = await lockRow(MY_COMPILATION);
  check('编册写回 e1，locked_at 与 locked_by 都空',
    backE1.compilation_status === 'e1' && backE1.locked_label === '' && backE1.locked_by === null,
    JSON.stringify(backE1));
  const backB1 = await bookRow(MY_CHILD, TERM);
  check('那一本写回 b1，published_at 空',
    backB1.book_status === 'b1' && backB1.published_label === '',
    JSON.stringify(backB1));
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
      check(`收拾失败，探针建的 n4 可能还留在库里（notification_id > ${mineFrom}）：`
        + `${err && err.message}`, false);
    }
    try { await db.end(); } catch { /* 已经断开就算了 */ }
    clearTimeout(timer);
    sb.report();
  });
