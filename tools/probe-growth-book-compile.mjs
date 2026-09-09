/**
 * 编册取回、全班预检与幂等重放的探针（issue #29 那三条漂移）。**会改数据库，跑完自己收拾。**
 *
 *   `POST /teacher/growth-book/compilation`                        取回或建立本班本学期的编册
 *   `GET  /teacher/growth-book/precheck`                           全班预检（零写入）
 *   `POST /teacher/growth-book/sections/{section_id}/reminders`    提醒家长补交（建 n4），幂等键必填
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 是原样的，
 * `Idempotency-Key` 这颗头也是它按 §1.4 拼的。所以路径写错、头没带出去都会红。
 *
 * ── 为什么另起一支，不并进 `probe-growth-book.mjs` ─────────────────────────
 *
 * 三个理由，缺一不可：
 *   1. `services/growth-book.js` 只做 G68 那一族（成长素材与在园时光主题），编册、
 *      栏目与成册三族的 service 留给 issue #27。本探针因此直接打 `utils/request.js`，
 *      与那一支「页面 → service → 契约」的走法不是同一条路；并在一起会让一支探针
 *      一半走 service、一半走裸传输，红了以后分不清是哪一层。
 *   2. 两支的收拾面不同：那一支的基线是 `db_moment`／`db_growth_material`／
 *      `db_growth_book_time_topic`，本支是 `db_notification`／
 *      `db_growth_book_compilation`。混在一起，一支中途炸掉会连累另一支的基线核对。
 *   3. `tools/probe-*.mjs` 一支一题，这是本仓库现有 12 支的组织方式（CLAUDE.md §6）。
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
 *   幂等键必填        不带 `Idempotency-Key` 打 `/reminders` 回 **422**，
 *                     且 `db_notification` 一行不增
 *   重放不重写        同键第二发回**逐字相同的响应体**，`db_notification` 的行数
 *                     与最大 id **都不动**
 *   同键异体          同一把键换一个请求体回 **422 `idempotency_key_reused`**，
 *                     且仍然一行不增（§4.3）
 *   新键要再发一轮    规则 99 明写「教师再次明确点击可以产生新一轮通知」——
 *                     幂等键管的是重发，不是「不准再提醒一次」
 *
 * 本探针建的行只有 `/reminders` 那几批 `db_notification`，跑完按
 * `owner_object='db_growth_book_section'` 与本次的 id 区间逐行删掉，核对行数回 `STATS.md`。
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
const wire = [];
const rawRequest = wx.request;
wx.request = (opts) => rawRequest({
  ...opts,
  success: (res) => {
    wire.push({ url: opts.url, method: opts.method, status: res.statusCode });
    opts.success(res);
  },
});
const lastStatus = () => (wire.length ? wire[wire.length - 1].status : null);

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

// STATS.md 的基线。跑完必须回到这两个数。
const BASE_NOTIFICATIONS = 1203;
const BASE_COMPILATIONS = 12;

/** 本次 `/reminders` 建出来的 n4 都在这个 id 之后，收尾按它删。 */
let mineFrom = null;

const PATHS = {
  compilation: '/teacher/growth-book/compilation',
  precheck: '/teacher/growth-book/precheck',
  reminders: `/teacher/growth-book/sections/${MY_SECTION}/reminders`,
};

async function counts() {
  const r = await db.query(
    `SELECT (SELECT count(*)::int FROM db_notification) AS notifications,
            (SELECT count(*)::int FROM db_growth_book_compilation) AS compilations,
            (SELECT COALESCE(max(notification_id), 0) FROM db_notification) AS max_notification`,
  );
  return r.rows[0];
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

/** 断言这一发被拒，**且 `db_notification` 一行不增**（§7.5）。 */
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
  check(`${label} 之后 db_notification 一行不增`,
    after.notifications === before.notifications
    && after.max_notification === before.max_notification,
    `${before.notifications}/${before.max_notification} → `
    + `${after.notifications}/${after.max_notification}`);
}

async function main() {
  await db.connect();

  const start = await counts();
  console.log(`基线：db_notification=${start.notifications}，`
    + `db_growth_book_compilation=${start.compilations}`);
  check('db_notification 基线与 STATS.md 一致',
    start.notifications === BASE_NOTIFICATIONS, `实际 ${start.notifications}`);
  check('db_growth_book_compilation 基线与 STATS.md 一致',
    start.compilations === BASE_COMPILATIONS, `实际 ${start.compilations}`);

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
  // 所以这里送的是 `unfilled`，不是上面那份按规则 95 过滤过的名单。
  await refuses('不带 Idempotency-Key 打 /reminders',
    () => api.post(PATHS.reminders, { body: { child_ids: unfilled } }),
    'validation_failed', 'required');

  const before = await counts();
  mineFrom = before.max_notification;
  const key = api.uuid();
  const body = { child_ids: unfilled };
  const one = await api.post(PATHS.reminders, { body, idempotencyKey: key });
  const afterOne = await counts();
  check('第一发 /reminders 真的建了 n4',
    afterOne.notifications > before.notifications,
    `${before.notifications} → ${afterOne.notifications}`);

  // 库里数一遍应该建几行：未交齐的幼儿 × 动作当下每名 caretaker（规则 99）。
  const expected = (await db.query(
    `SELECT count(*)::int AS n
       FROM db_child ch, jsonb_array_elements(ch.caretakers) e
      WHERE ch.child_id = ANY($1::int[])`,
    [unfilled],
  )).rows[0].n;
  check(`建出来的行数等于「未交齐的幼儿 × 当下 caretaker」（库里数得 ${expected}）`,
    afterOne.notifications - before.notifications === expected,
    `实际多了 ${afterOne.notifications - before.notifications}`);

  // 本探针不修的两处已知漂移，现测现记（`note` 不算失败 —— 服务端补齐之后它自己会消失）。
  note('POST /reminders 的回包与契约声明的键对不上：契约是 '
    + '{notified_child_count, notification_count}',
    `实际收到的键：${Object.keys(one).join(', ')}`);
  note('POST /reminders 的 child_ids 收下即丢：服务端自己数「本班未交齐的幼儿」，'
    + '不看请求体那份名单（契约把它标成 required、minItems 1）',
    `送了 ${unfilled.length} 个 id，建了 ${afterOne.notifications - before.notifications} 行`);

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
      body: { child_ids: unfilled.slice(0, 1) },
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
}

/**
 * 收拾：本探针只建了 `/reminders` 那几批 `db_notification`，按本次的 id 区间删掉。
 * 编册那一族一行都没动过，所以不用写回。
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
  const end = await counts();
  check(`逐表行数回到 STATS.md 的基线（db_notification=${BASE_NOTIFICATIONS}，`
    + `db_growth_book_compilation=${BASE_COMPILATIONS}）`,
    end.notifications === BASE_NOTIFICATIONS && end.compilations === BASE_COMPILATIONS,
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
      check(`收拾失败，探针建的 n4 可能还留在库里（notification_id > ${mineFrom}）：`
        + `${err && err.message}`, false);
    }
    try { await db.end(); } catch { /* 已经断开就算了 */ }
    clearTimeout(timer);
    sb.report();
  });
