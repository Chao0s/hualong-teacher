/**
 * 评估族（学期评价、综合评估、成长档案、办园质量评估）的探针。
 * **会改数据库，跑完自己收拾。**
 *
 * 桩掉 `wx.*` 之后加载**未经修改的发布代码**：`utils/request.js` 与
 * `services/assessment.js` 全是原样的。所以路径写错、字段改名、枚举译反都会红。
 *
 * 这一族要钉的东西：
 *
 *   未评≠0 分  `items` 只含已评题。断言**逐幼儿三头钉**：回包的 `completedCount` =
 *              库里那一列 = 真实题项行数。只钉回包的话，computed 列自己漂了看不出来。
 *   名册左连接  行 = 本班在园名册，不是「回包里出现过的幼儿」。一名幼儿一行记录都
 *              没有时**照样要出现在表上**，那正是最该被发现的情形。
 *   题项级均值  报告的 `total_average` 是全部已评题项的均值，**不是五个领域均分再
 *              平均**。两者实测 4.330645 vs 4.336181，四舍五入到一位小数都是 4.3 ——
 *              **只有钉到小数第四位才抓得到**（CLAUDE.md §7.6）。
 *   范围两头钉  「看得见 10 行」不够：范围改坏了也可能照样是 10 行。同时钉「别班的
 *              child_id 一个都没漏进来」「上学期的主记录 id 一个都没出现」。
 *   拒之后没变  给已完成的评估打分要被拒，**且库里那一行没变**（§7.5）。一个回 409
 *              却真的写了的实作，只看状态码是看不出来的。
 *   跨源比对    库里 `db_scale_item` 的 124 题与包内 `data/guide-scale.js` 逐题比。
 *              两份内容漂开当场红 —— 一份复制品不是冗余，是一次静默过期。
 *
 * ── 已知会红的项（服务端实作漂移，由 #30 承接，不是本探针的 bug）───────────
 *
 * 这一类项**用 `note()` 登记，不用 `check()` 报失败**：红久了就没人看了，而删掉之后
 * 「客户端发错了」与「服务端没接住」在报告上长得一模一样。每条 `note()` 写清症状、
 * 证据、解封条件、归谁修。
 *
 * **本探针的验收口径是 0 项失败。** `note()` 的条数会打印出来（「N 条服务端已知缺口」），
 * 条数变多就去看新增那一条。**2026-09-09 实测：280 项通过、0 项失败、21 条缺口**
 * （逐组：growth 42/0/2、term 59/0/2、child 113/0/5、report 37/0/4、quality 53/0/6、
 * scale 31/0/2 —— 六组各自跑时都含 8 项共用的会话与基线断言，所以逐组之和大于全跑）。
 * 20 条归 #30，1 条归 G83（`reference_table` 要不要暴露，契约未裁定）。
 *
 *   node tools/probe-assessment.mjs                 全部六组
 *   node tools/probe-assessment.mjs --group=growth   成长档案
 *   node tools/probe-assessment.mjs --group=term     学期评价
 *   node tools/probe-assessment.mjs --group=child    综合评估进度与填写
 *   node tools/probe-assessment.mjs --group=report   两张报告
 *   node tools/probe-assessment.mjs --group=quality  办园质量评估
 *   node tools/probe-assessment.mjs --group=scale    题库跨源比对
 *   node tools/probe-assessment.mjs --group=term,child   逗号分隔可以点几组
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
const co = require_(resolve(MP, 'services', 'co-education.js'));
const guard = require_(resolve(MP, 'utils', 'guard.js'));
const { flatDomains } = require_(resolve(MP, 'data', 'guide-scale.js'));
const { Client } = require_(resolve(TESTDATA, 'node_modules', 'pg'));

const sb = scoreboard();
const check = sb.check.bind(sb);
const note = sb.note.bind(sb);

const db = new Client(DB_URL);

/* ── 基线（STATS.md + 2026-09-09 实测）───────────────────────────────────── */

const BASE = {
  term_eval: 120,
  child_assessment: 120,
  cai: 10055,
  growth_record: 120,
  assessment: 13,
  assessment_item: 1176,
};
/** 教师 1 是 1 班主班，班上 10 名在园幼儿（`enrollment_status='e1'`）。 */
const CLASS_ID = 1;
const CLASS_SIZE = 10;
/** 数据集的「今天」是 2026-04-25，所以当前学期是第二学期。 */
const CURRENT_TERM = '2025-2026-2';
const PREV_TERM = '2025-2026-1';
/** class 1 / 当前学期：child 7 与 child 9 是 c1（124 题），其余 c2。 */
const C1_CHILD = 7;
/** child 2 是 62 题的草稿，**K 与 A 整域一题未评** —— 领域缺席那一条钉在这里。 */
const DRAFT_CHILD = 2;
/** child 1 一题未评（无题项行）。本探针的写入都打在这一个身上，跑完删干净。 */
const EMPTY_CHILD = 1;
/** 教师 1 的三份质量评估：7 是唯一 s2（可写）的一份，1 与 13 都是 s3。 */
const ASMT_WRITABLE = 7;
const ASMT_DONE = 1;
/** class 1 / 当前学期逐幼儿的 completed_count（实测，数据集不变时永远这样）。 */
const EXPECT_COMPLETED = { 1: 0, 2: 62, 3: 62, 4: 0, 5: 62, 6: 62, 7: 124, 8: 0, 9: 124, 10: 0 };
const EXPECT_STATE = {
  1: 'miss', 2: 'draft', 3: 'draft', 4: 'miss', 5: 'draft',
  6: 'draft', 7: 'done', 8: 'miss', 9: 'done', 10: 'miss',
};
/** 个人报告要钉的数（`child_assessment_id=14`，class 1 child 7，124 题全评）。 */
const EXPECT_REPORT_7 = {
  H: { item_count: 36, average: 4.2778 },
  L: { item_count: 24, average: 4.2917 },
  S: { item_count: 30, average: 4.4000 },
  K: { item_count: 23, average: 4.3478 },
  A: { item_count: 11, average: 4.3636 },
};
/** 题项级均值。五个领域均分再平均是 4.336181 —— **两个数不同，钉的是前一个**。 */
const EXPECT_TOTAL_AVG_7 = 4.330645;
const WRONG_TOTAL_AVG_7 = 4.336181;
/** 班级报告（class 1 / 当前学期，只统计 c1 = child 7 + child 9）。 */
const EXPECT_CLASS_REPORT = {
  H: { item_count: 72, average: 4.3194 },
  L: { item_count: 48, average: 4.3125 },
  S: { item_count: 60, average: 4.3833 },
  K: { item_count: 46, average: 4.3696 },
  A: { item_count: 22, average: 4.3636 },
};
/** 题库领域分布（`db_scale_item` 的 `left(item_id,1)`）。 */
const EXPECT_DOMAIN_SIZE = { H: 36, L: 24, S: 30, K: 23, A: 11 };

/**
 * 本探针改过的行，`cleanup()` 逐条还原。
 *
 * `updated_at` 还不回去 —— 三张表都有 `trg_*_touch` 触发器，任何 UPDATE 都会把它
 * 盖成 `now()`。所以基线核对钉的是**行数与语义列**（`score` / `note` / 状态 / 计数），
 * 不钉 `updated_at`。
 */
const made = [];

async function scalar(sql, params = []) {
  const r = await db.query(sql, params);
  return r.rows[0] ? Object.values(r.rows[0])[0] : null;
}

async function counts() {
  const r = await db.query(`SELECT
    (SELECT count(*)::int FROM db_term_eval) term_eval,
    (SELECT count(*)::int FROM db_child_assessment) child_assessment,
    (SELECT count(*)::int FROM db_child_assessment_item) cai,
    (SELECT count(*)::int FROM db_growth_record) growth_record,
    (SELECT count(*)::int FROM db_assessment) assessment,
    (SELECT count(*)::int FROM db_assessment_item) assessment_item`);
  return r.rows[0];
}

/** 四位小数比一次。`toFixed` 之后比字符串，避免浮点尾差。 */
function near(actual, expected, digits = 4) {
  if (actual === null || actual === undefined) return false;
  return Number(actual).toFixed(digits) === Number(expected).toFixed(digits);
}

/* ── 组 1 · 成长档案 ────────────────────────────────────────────────────── */

async function groupGrowth() {
  console.log('\n[growth] 成长档案 —— GET /growth-records');

  const board = await assess.growthRecordBoard();

  check(`进度表回 ${CLASS_SIZE} 行（本班在园名册整份）`,
    board.rows.length === CLASS_SIZE, `拿到 ${board.rows.length} 行`);
  check('列只有 5 个（第六列「成长册」没有数据源，不渲染）',
    board.columns.length === 5, `实际 ${board.columns.length} 列：${board.columns.map((c) => c.label).join(',')}`);
  check('列的次序是 家长月度/家长学期/教师月度/教师学期/综合',
    board.columns.map((c) => c.key).join(',')
      === 'parentMonth,parentTerm,teacherMonth,teacherTerm,comprehensive',
    board.columns.map((c) => c.key).join(','));
  check('没有任何一列叫「成长册」',
    board.columns.every((c) => !/成长册/.test(c.group + c.label)), '出现了成长册列');

  // 逐行钉到库里那一行，五个格子逐格重算一次。
  const rows = await db.query(
    `SELECT child_id, required_month_count, teacher_month_complete_count,
            parent_month_complete_count, teacher_term_status, parent_term_status,
            comprehensive_assessment_status, is_term_end, record_status
       FROM db_growth_record WHERE class_id=$1 AND term_id=$2 ORDER BY child_id`,
    [CLASS_ID, CURRENT_TERM],
  );
  check(`库里 class ${CLASS_ID} / ${CURRENT_TERM} 有 ${CLASS_SIZE} 行档案`,
    rows.rows.length === CLASS_SIZE, `实际 ${rows.rows.length} 行`);

  const byChild = new Map(board.rows.map((r) => [r.childId, r]));
  for (const dbRow of rows.rows) {
    const got = byChild.get(dbRow.child_id);
    if (!got) {
      check(`child ${dbRow.child_id} 在进度表上`, false, '这一行没出现');
      continue;
    }
    const need = dbRow.required_month_count;
    const want = [
      need > 0 && dbRow.parent_month_complete_count >= need ? 'done' : 'miss',
      dbRow.parent_term_status === 'c1' ? 'done' : 'miss',
      need > 0 && dbRow.teacher_month_complete_count >= need ? 'done' : 'miss',
      dbRow.teacher_term_status === 'c1' ? 'done' : 'miss',
      dbRow.comprehensive_assessment_status === 'c1' ? 'done' : 'miss',
    ];
    check(`child ${dbRow.child_id} 的五个格子与库里逐格相同`,
      got.states.join(',') === want.join(','),
      `回包 ${got.states.join(',')} / 库 ${want.join(',')}`);
    check(`child ${dbRow.child_id} 的 recordStatus 是 ${dbRow.record_status}`,
      got.recordStatus === dbRow.record_status, `实际 ${got.recordStatus}`);
  }

  // 实测：class 1 当前学期 required_month_count=2，只有 child 7 与 child 9 的
  // comprehensive_assessment_status 是 c1，其余四列全 c2 —— 所以「综合」那一格
  // 只有两个 done。这一格钉的是「五列判定没有整列写死」。
  const comp = board.rows.filter((r) => r.states[4] === 'done').map((r) => r.childId);
  check('「综合」那一列只有 child 7 与 child 9 是 done',
    comp.join(',') === '7,9', `实际 ${comp.join(',') || '(空)'}`);
  check('五列不是整列同值（家长学期全 miss、综合有两个 done）',
    board.rows.every((r) => r.states[1] === 'miss') && comp.length === 2,
    '五列判定可能写死了');

  check(`全班 record_status 都是 c2（未齐备），summary.done 为 0`,
    board.summary.done === 0 && board.summary.total === CLASS_SIZE,
    JSON.stringify(board.summary));

  // 范围两头钉：只写「10 行」不够，范围改坏了也可能照样是 10 行。
  const mine = board.rows.map((r) => r.childId);
  const others = await db.query(
    "SELECT child_id FROM db_child WHERE class_id <> $1 AND enrollment_status='e1'", [CLASS_ID]);
  const leaked = others.rows.map((r) => r.child_id).filter((id) => mine.includes(id));
  check('别班的幼儿一个都没漏进来', leaked.length === 0, `漏了 ${leaked.join(',')}`);

  // 学期两头钉：上学期那 10 行的 required_month_count 是 5，当前学期是 2。
  const prevNeed = await scalar(
    'SELECT DISTINCT required_month_count FROM db_growth_record WHERE class_id=$1 AND term_id=$2',
    [CLASS_ID, PREV_TERM]);
  check(`上学期的 required_month_count 是 ${prevNeed}，当前学期是 2 —— 两学期不同`,
    Number(prevNeed) === 5, `实际 ${prevNeed}`);
  const teacherMonthDone = board.rows.filter((r) => r.states[2] === 'done').length;
  check('教师月度那一列没有混进上学期的行（上学期全齐，当前学期一个都不齐）',
    teacherMonthDone === 0, `实际 ${teacherMonthDone} 个 done`);

  // 服务端漂移：集合端点不回 is_term_end，也不回 class_id。
  const raw = await api_get('/growth-records');
  const sample = (raw.items || [])[0] || {};
  if (sample.is_term_end === undefined || sample.class_id === undefined) {
    note(
      'GET /growth-records 不回 `is_term_end` 与 `class_id`（契约的 GrowthRecord 两个都 required）。',
      `实测回包的键：${Object.keys(sample).join(', ')}；`
      + 'routes/teacher.mjs 的 listGrowthRecords SELECT 里没有这两列。'
      + ' service 给 isTermEnd 兜底 false（学期末口径的提示语因此一律不显示）。'
      + ' 解封：本行的 `check(is_term_end 回包带上了)` 由 note 换回 check 并变绿。归 #30。',
    );
  } else {
    check('GET /growth-records 回了 is_term_end 与 class_id', true);
  }
  if ((raw.items || []).some((r) => r.term_id && r.term_id !== CURRENT_TERM)) {
    note(
      'GET /growth-records 把两个学期都回来了（契约明写学期由服务端派生，只该回当前学期）。',
      `实测 class ${CLASS_ID} 回 ${(raw.items || []).length} 行，含 ${PREV_TERM} 与 ${CURRENT_TERM}；`
      + ' 不筛就是一名幼儿两行、进度表翻倍。service 按会话的 current_term.term_id 筛一次'
      + '（服务端修好后是空操作）。解封：回包里只剩当前学期。归 #30。',
    );
  } else {
    check('GET /growth-records 只回当前学期', true);
  }
}

/* ── 组 2 · 学期评价 ────────────────────────────────────────────────────── */

async function teRow(childId, teacherId = 1, termId = CURRENT_TERM) {
  const r = await db.query(
    `SELECT term_eval_id, eval_text, term_eval_status,
            to_char(submitted_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS submitted_text,
            submitted_at
       FROM db_term_eval WHERE child_id=$1 AND teacher_id=$2 AND term_id=$3`,
    [childId, teacherId, termId],
  );
  return r.rows[0] || null;
}

async function groupTerm() {
  console.log('\n[term] 学期评价 —— GET /term-evaluations, GET/PUT /children/{id}/term-evaluation');

  const board = await assess.termEvaluationBoard();
  check(`进度表回 ${CLASS_SIZE} 行（本班在园名册整份）`,
    board.rows.length === CLASS_SIZE, `拿到 ${board.rows.length} 行`);
  check('第一行是 child 1，按 child_id 升序',
    board.rows.map((r) => r.childId).join(',') === '1,2,3,4,5,6,7,8,9,10',
    board.rows.map((r) => r.childId).join(','));

  // 逐行钉到库里：当前学期 class 1 的 10 行全 c2，上学期全 c1。
  for (const row of board.rows) {
    const dbRow = await teRow(row.childId);
    check(`child ${row.childId} 的 status 与库里那一列相同`,
      dbRow && row.status === dbRow.term_eval_status,
      `回包 ${row.status} / 库 ${dbRow ? dbRow.term_eval_status : '(无行)'}`);
    check(`child ${row.childId} 的 termEvalId 与库里那一行相同`,
      dbRow && row.termEvalId === dbRow.term_eval_id,
      `回包 ${row.termEvalId} / 库 ${dbRow ? dbRow.term_eval_id : '(无行)'}`);
  }
  check('当前学期全班「未完成」，summary.done 为 0',
    board.summary.done === 0 && board.summary.total === CLASS_SIZE,
    JSON.stringify(board.summary));

  // 对外二元：doneLabel 只有两种字，不出现「草稿」。
  const labels = [...new Set(board.rows.map((r) => r.statusLabel))];
  check('状态标签只有「未完成」这一种（对外二元，没有草稿态）',
    labels.length === 1 && labels[0] === '未完成', labels.join(','));

  // 范围两头钉。
  const mine = board.rows.map((r) => r.childId);
  const others = await db.query(
    "SELECT child_id FROM db_child WHERE class_id <> $1 AND enrollment_status='e1'", [CLASS_ID]);
  const leaked = others.rows.map((r) => r.child_id).filter((id) => mine.includes(id));
  check('别班的幼儿一个都没漏进来', leaked.length === 0, `漏了 ${leaked.join(',')}`);
  const prevIds = (await db.query(
    'SELECT term_eval_id FROM db_term_eval WHERE class_id=$1 AND term_id=$2', [CLASS_ID, PREV_TERM]
  )).rows.map((r) => r.term_eval_id);
  check('上学期那 10 行的 term_eval_id 一个都没出现',
    board.rows.every((r) => !prevIds.includes(r.termEvalId)),
    `漏了 ${board.rows.filter((r) => prevIds.includes(r.termEvalId)).map((r) => r.termEvalId).join(',')}`);

  // 单条：无正文的那一列。
  const one = await assess.getTermEvaluation(EMPTY_CHILD);
  const dbOne = await teRow(EMPTY_CHILD);
  check(`child ${EMPTY_CHILD} 的单条回了库里那一行（term_eval_id=${dbOne.term_eval_id}）`,
    one && one.termEvalId === dbOne.term_eval_id, JSON.stringify(one));
  check('正文为空时给空串，不给 undefined', one && one.text === '', JSON.stringify(one && one.text));
  check(`textMax 是 DDL 的 VARCHAR(500)`, one && one.textMax === 500, `实际 ${one && one.textMax}`);
  check('未提交时 submittedLabel 是「—」', one && one.submittedLabel === '—', one && one.submittedLabel);
  check('未提交时 done 为假', one && one.done === false, JSON.stringify(one && one.done));

  const raw = await api_get(`/children/${EMPTY_CHILD}/term-evaluation`);
  if (raw.file_id === undefined) {
    note(
      'GET /children/{child_id}/term-evaluation 不回 `file_id[]`（契约的 TermEvaluation 有这一项，'
      + '派生自 db_file_ref owner_object=db_term_eval）。',
      `实测回包的键：${Object.keys(raw).join(', ')}；routes/teacher.mjs 的 getTermEvaluation`
      + ' 是 `SELECT t.*`，本表没有 file_id 列，也没有 JOIN db_file_ref。'
      + ' 因此 teacher-term-form 的照片区本轮不渲染任何一张，入口置灰。'
      + ' 解封：回包带上 file_id[]，照片区接 services/media.js 的 photoUrls。归 #30。',
    );
  } else {
    check('GET 单条回了 file_id[]', Array.isArray(raw.file_id));
  }

  // 作者范围：唯一键含 teacher_id（B9），本人那条端点不得回别人写的那一列。
  // 数据集里每名幼儿每学期只有主班一笔，所以这个场景要自己造。
  const insertOther = await db.query(
    `INSERT INTO db_term_eval (school_id, class_id, child_id, teacher_id, term_id,
                               eval_text, term_eval_status, submitted_at)
     VALUES (1, $1, $2, 2, $3, '别的教师写的那一笔', 'c1', '2026-04-01 10:00:00')
     RETURNING term_eval_id`,
    [CLASS_ID, EMPTY_CHILD, CURRENT_TERM],
  );
  const otherId = insertOther.rows[0].term_eval_id;
  try {
    const again = await assess.getTermEvaluation(EMPTY_CHILD);
    if (again && again.termEvalId === otherId) {
      note(
        'GET /children/{child_id}/term-evaluation 不按 teacher_id 过滤，回了别的教师写的那一列。',
        `造了一笔 teacher_id=2 的行（term_eval_id=${otherId}），端点回的就是它；`
        + ' 契约的 x-hualong-scope 有 `teacher_id=$ctx_teacher`，'
        + ' routes/teacher.mjs 的 WHERE 里没有这个条件，只有 ORDER BY term_id DESC LIMIT 1。'
        + ' 解封：造出这一行之后端点仍回本人那一列。归 #30。',
      );
    } else {
      check('别的教师写的那一列没有回给本人',
        again && again.termEvalId === dbOne.term_eval_id,
        `回了 term_eval_id=${again && again.termEvalId}，期望 ${dbOne.term_eval_id}`);
    }
    // 两个学期同时存在时也不得回上学期那一列。
    check('单条回的是当前学期那一列',
      again && again.termId === CURRENT_TERM, `实际 ${again && again.termId}`);
  } finally {
    await db.query('DELETE FROM db_term_eval WHERE term_eval_id=$1', [otherId]);
    await db.query("SELECT setval('db_term_eval_term_eval_id_seq', (SELECT max(term_eval_id) FROM db_term_eval))");
  }

  // 预检：回空串表示可以。**预检不是校验**，下面紧接着让服务端也验一次。
  check('空正文预检不通过',
    assess.whyCannotSubmitTermEvaluation({ text: '   ' }) !== '', '空正文竟然放行了');
  check('501 字预检不通过',
    assess.whyCannotSubmitTermEvaluation({ text: 'x'.repeat(501) }) !== '', '超框竟然放行了');
  check('500 字预检通过',
    assess.whyCannotSubmitTermEvaluation({ text: 'x'.repeat(500) }) === '', '刚好 500 字被挡了');

  /* ── 写 ──────────────────────────────────────────────────────────────── */

  const before = await teRow(EMPTY_CHILD);
  made.push({
    kind: 'termEval',
    termEvalId: before.term_eval_id,
    eval_text: before.eval_text,
    term_eval_status: before.term_eval_status,
    submitted_at: before.submitted_at,
  });

  const TEXT = `probe-assessment 学期评价 ${Date.now()}`;
  await assess.submitTermEvaluation(EMPTY_CHILD, { text: TEXT });
  const after = await teRow(EMPTY_CHILD);
  // 断言值，不断言形状（§7.6）：正文逐字比，不是「有正文」。
  check('正文逐字落库', after.eval_text === TEXT, `实际 ${JSON.stringify(after.eval_text)}`);
  check('状态从 c2 变成 c1（一次写成，没有草稿）',
    after.term_eval_status === 'c1', `实际 ${after.term_eval_status}`);
  check('submitted_at 由服务端盖上了', after.submitted_at !== null, '仍是 NULL');

  const board2 = await assess.termEvaluationBoard();
  const cell = board2.rows.find((r) => r.childId === EMPTY_CHILD);
  check(`进度表那一格随之变成「已完成」`, cell && cell.done === true, JSON.stringify(cell));
  check('summary.done 从 0 变成 1', board2.summary.done === 1, `实际 ${board2.summary.done}`);
  check('submittedLabel 不再是「—」', cell && cell.submittedLabel !== '—', cell && cell.submittedLabel);

  // 500 字上限：服务端独立验一次。
  await refusesTermEval('501 字的正文', EMPTY_CHILD, 'x'.repeat(501), 'validation_failed');
  // 别班的幼儿：拒，且别班那一行一个字没变。
  const otherChild = (await db.query(
    "SELECT child_id FROM db_child WHERE class_id <> $1 AND enrollment_status='e1' ORDER BY child_id LIMIT 1",
    [CLASS_ID])).rows[0].child_id;
  const otherBefore = await teRow(otherChild, 1);
  const otherAny = await db.query(
    'SELECT eval_text, term_eval_status FROM db_term_eval WHERE child_id=$1 AND term_id=$2',
    [otherChild, CURRENT_TERM]);
  let rejected = '(没被拒)';
  try {
    await assess.submitTermEvaluation(otherChild, { text: '越界写入' });
  } catch (err) { rejected = err.code; }
  check(`别班 child ${otherChild} 的写入被拒（404）`, rejected === 'not_found', `实际 ${rejected}`);
  const otherAfter = await db.query(
    'SELECT eval_text, term_eval_status FROM db_term_eval WHERE child_id=$1 AND term_id=$2',
    [otherChild, CURRENT_TERM]);
  check('拒之后别班那一行一个字没变',
    JSON.stringify(otherAfter.rows) === JSON.stringify(otherAny.rows),
    `${JSON.stringify(otherAny.rows)} → ${JSON.stringify(otherAfter.rows)}`);
  check('别班那一行本来就不是本人写的（作者范围的另一头）',
    otherBefore === null || otherBefore.term_eval_id !== before.term_eval_id, 'id 撞了');

  // 契约回 201 + Location，服务端回 200 且改的是已有行。
  const rawPut = await api_get(`/children/${EMPTY_CHILD}/term-evaluation`);
  if (rawPut.term_eval_id === before.term_eval_id) {
    note(
      'PUT /children/{child_id}/term-evaluation 是 UPDATE 已有行、回 200，契约要 INSERT、'
      + '回 201 + Location（action-registry 的 term_eval.submit 是 NONE→c1）。',
      `写入前后 term_eval_id 都是 ${before.term_eval_id}，行数不变（120 行）；`
      + ' routes/teacher.mjs 的 submitTermEvaluation 走 UPDATE ... WHERE，名册幼儿无行时回 404。'
      + ' 数据集里每名幼儿每学期都预建了行，所以模拟器里看不出来。'
      + ' service 两个状态码都接受（request.js 不校验状态码）。'
      + ' 解封：无行的幼儿 PUT 一次能建出行并回 201。归 #30。',
    );
  } else {
    check('PUT 建了新行', true);
  }
}

/** 断言学期评价的某次写入被拒，**且库里那一行没变**（§7.5）。 */
async function refusesTermEval(label, childId, text, expectCode) {
  const before = await teRow(childId);
  let code = '(没被拒)';
  try {
    await assess.submitTermEvaluation(childId, { text });
  } catch (err) { code = err.code; }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  const after = await teRow(childId);
  check(`${label} 之后正文没变`,
    (after && after.eval_text) === (before && before.eval_text),
    `${JSON.stringify(before && before.eval_text)} → ${JSON.stringify(after && after.eval_text)}`);
  check(`${label} 之后状态没变（仍 ${before && before.term_eval_status}）`,
    (after && after.term_eval_status) === (before && before.term_eval_status),
    `${before && before.term_eval_status} → ${after && after.term_eval_status}`);
}

/* ── 组 3 · 综合评估进度与填写 ─────────────────────────────────────────── */

/** 库里那一行的裸值 + **真实题项行数**。回包不可信时以这里为准。 */
async function caRow(childId, termId = CURRENT_TERM) {
  const r = await db.query(
    `SELECT a.child_assessment_id, a.child_id, a.term_id, a.scale_code, a.scale_version,
            a.required_count, a.completed_count, a.child_assessment_status, a.submitted_at,
            (SELECT count(*)::int FROM db_child_assessment_item i
              WHERE i.child_assessment_id = a.child_assessment_id) AS real_items
       FROM db_child_assessment a
      WHERE a.child_id = $1 AND a.term_id = $2`,
    [childId, termId],
  );
  return r.rows[0] || null;
}

async function groupChild() {
  console.log('\n[child] 综合评估 —— GET /child-assessments, GET/PUT /children/{id}/child-assessment');

  const board = await assess.childAssessmentProgress();
  check(`进度表回 ${CLASS_SIZE} 行（本班在园名册整份）`,
    board.rows.length === CLASS_SIZE, `拿到 ${board.rows.length} 行`);

  // 逐幼儿三头钉：回包 = 库里那一列 = 真实题项行数。
  for (const row of board.rows) {
    const dbRow = await caRow(row.childId);
    check(`child ${row.childId} 的 completedCount 与库里那一列相同`,
      dbRow && row.completedCount === dbRow.completed_count,
      `回包 ${row.completedCount} / 库 ${dbRow ? dbRow.completed_count : '(无行)'}`);
    check(`child ${row.childId} 库里 completed_count 等于真实题项行数`,
      dbRow && dbRow.completed_count === dbRow.real_items,
      `列 ${dbRow ? dbRow.completed_count : '?'} / 行 ${dbRow ? dbRow.real_items : '?'}`);
    check(`child ${row.childId} 的 completedCount 是 ${EXPECT_COMPLETED[row.childId]}`,
      row.completedCount === EXPECT_COMPLETED[row.childId], `实际 ${row.completedCount}`);
    check(`child ${row.childId} 的 requiredCount 是 124`,
      row.requiredCount === 124, `实际 ${row.requiredCount}`);
    check(`child ${row.childId} 的三态是 ${EXPECT_STATE[row.childId]}`,
      row.state === EXPECT_STATE[row.childId], `实际 ${row.state}`);
  }

  // 三态与二元折算是两件事：done 两个，而 draft 四个在聚合视图里都算未完成。
  check('三态里 done 只有 child 7 与 child 9',
    board.rows.filter((r) => r.state === 'done').map((r) => r.childId).join(',') === '7,9',
    board.rows.filter((r) => r.state === 'done').map((r) => r.childId).join(','));
  check('三态里 draft 有四个（62 题那四名）',
    board.rows.filter((r) => r.state === 'draft').length === 4,
    `实际 ${board.rows.filter((r) => r.state === 'draft').length} 个`);
  check('二元折算：summary.done 是 2，草稿不算完成',
    board.summary.done === 2, `实际 ${board.summary.done}`);
  check('binaryDone 把 62/124 折算成未完成',
    assess.binaryDone({ completed_count: 62, required_count: 124 }) === false, '草稿被算成完成了');
  check('tristate 把 62/124 判成 draft',
    assess.tristate({ completed_count: 62, required_count: 124 }) === 'draft',
    assess.tristate({ completed_count: 62, required_count: 124 }));
  check('tristate 把 0/124 判成 miss（不是 draft）',
    assess.tristate({ completed_count: 0, required_count: 124 }) === 'miss',
    assess.tristate({ completed_count: 0, required_count: 124 }));

  // 范围两头钉。
  const mine = board.rows.map((r) => r.childId);
  const others = await db.query(
    "SELECT child_id FROM db_child WHERE class_id <> $1 AND enrollment_status='e1'", [CLASS_ID]);
  const leaked = others.rows.map((r) => r.child_id).filter((id) => mine.includes(id));
  check('别班的幼儿一个都没漏进来', leaked.length === 0, `漏了 ${leaked.join(',')}`);
  const prevIds = (await db.query(
    'SELECT child_assessment_id FROM db_child_assessment WHERE class_id=$1 AND term_id=$2',
    [CLASS_ID, PREV_TERM])).rows.map((r) => r.child_assessment_id);
  check('上学期那 10 份主记录 id 一个都没出现',
    board.rows.every((r) => !prevIds.includes(r.childAssessmentId)),
    `漏了 ${board.rows.filter((r) => prevIds.includes(r.childAssessmentId)).map((r) => r.childAssessmentId).join(',')}`);
  // 上学期那 10 份全是 124 题 c1，混进来的话 summary.done 会从 2 变成 12。
  check('上学期全 c1 混不进来（summary.done 仍是 2，不是 12）',
    board.summary.done === 2, `实际 ${board.summary.done}`);

  const rawList = await api_get('/child-assessments');
  const sample = (rawList.items || [])[0] || {};
  if (sample.scale_code === undefined || sample.scale_version === undefined) {
    note(
      'GET /child-assessments 不回 `scale_code` / `scale_version`（契约的 ChildAssessmentProgress 两个都有）。',
      `实测回包的键：${Object.keys(sample).join(', ')}；routes/teacher.mjs 的 listChildAssessments`
      + ' SELECT 里没有这两列。service 给 scaleCode / scaleVersion 兜底空串'
      + '（进度页上不显示量表编码，今天不咬人）。解封：回包带上这两列。归 #30。',
    );
  } else {
    check('GET /child-assessments 回了 scale_code 与 scale_version', true);
  }
  if ((rawList.items || []).some((r) => r.term_id && r.term_id !== CURRENT_TERM)) {
    note(
      'GET /child-assessments 把两个学期都回来了（契约明写学期由服务端派生）。',
      `实测 class ${CLASS_ID} 回 ${(rawList.items || []).length} 行，含 ${PREV_TERM} 与 ${CURRENT_TERM}；`
      + ' 上学期那 10 份全是 124 题 c1，不筛的话「已完成」会从 2 变成 12。'
      + ' service 按会话的 current_term.term_id 筛一次。解封：回包只剩当前学期。归 #30。',
    );
  } else {
    check('GET /child-assessments 只回当前学期', true);
  }

  /* ── 单条：未评 = 无列 ───────────────────────────────────────────────── */

  const draft = await assess.getChildAssessment(DRAFT_CHILD);
  check(`child ${DRAFT_CHILD} 的 completedCount 是 62`,
    draft.completedCount === 62, `实际 ${draft.completedCount}`);
  check('五个领域都在，次序是 H L S K A',
    draft.domains.map((d) => d.id).join(',') === 'H,L,S,K,A',
    draft.domains.map((d) => d.id).join(','));
  const byDomain = new Map(draft.domains.map((d) => [d.id, d]));
  check('H 领域 36 题全有分', byDomain.get('H').ratedCount === 36, `实际 ${byDomain.get('H').ratedCount}`);
  check('L 领域 24 题全有分', byDomain.get('L').ratedCount === 24, `实际 ${byDomain.get('L').ratedCount}`);
  check('S 领域只有 2 题有分', byDomain.get('S').ratedCount === 2, `实际 ${byDomain.get('S').ratedCount}`);
  check('K 领域一题都没有', byDomain.get('K').ratedCount === 0, `实际 ${byDomain.get('K').ratedCount}`);
  check('A 领域一题都没有', byDomain.get('A').ratedCount === 0, `实际 ${byDomain.get('A').ratedCount}`);
  check('K 领域的 scoreText 是「未评 0/23」，不是「平均 0.0」',
    byDomain.get('K').scoreText === '未评 0/23', byDomain.get('K').scoreText);
  check('未评的题 rated 为假且 score 为 0（0 只是显示值）',
    byDomain.get('K').items.every((i) => i.rated === false && i.score === 0), '有未评题带上了分');
  check('已评的题 rated 为真且 score 在 1..5',
    byDomain.get('H').items.every((i) => i.rated === true && i.score >= 1 && i.score <= 5),
    'H 领域有题的分不在 1..5');

  // 逐题钉到库里：回包的分与库里那一行逐条相同。
  const dbItems = await db.query(
    `SELECT i.item_id, i.score FROM db_child_assessment_item i
       JOIN db_child_assessment a USING (child_assessment_id)
      WHERE a.child_id=$1 AND a.term_id=$2`,
    [DRAFT_CHILD, CURRENT_TERM]);
  const dbMap = new Map(dbItems.rows.map((r) => [r.item_id, r.score]));
  const allItems = draft.domains.reduce((acc, d) => acc.concat(d.items), []);
  const wrong = allItems.filter((i) => (i.rated ? dbMap.get(i.id) !== i.score : dbMap.has(i.id)));
  check(`child ${DRAFT_CHILD} 的 124 题逐题与库里相同（已评的分相等、未评的库里无行）`,
    wrong.length === 0, `对不上 ${wrong.length} 题：${wrong.slice(0, 3).map((i) => i.id).join(',')}`);
  check('库里只有 62 行题项（未评的题没有行）', dbMap.size === 62, `实际 ${dbMap.size} 行`);

  // H1-1-1 的呈现：decision.md 第 13 条 —— 标签与说明改成主观评定。
  const h111 = byDomain.get('H').items.find((i) => i.id === 'H1-1-1');
  check('H1-1-1 的标签是「参考表辅助」，不是「实测换算」',
    h111 && h111.tag === '参考表辅助', h111 && h111.tag);
  check('H1-1-1 的说明写的是教师主观评定，且不采集身高体重',
    h111 && /主观评定/.test(h111.note) && /不采集身高体重/.test(h111.note), h111 && h111.note);
  check('H1-1-1 的参考范围表留着（教师的判断辅助）',
    h111 && Array.isArray(h111.ref) && h111.ref.length === 3,
    `实际 ${h111 && h111.ref ? h111.ref.length : '(无)'} 行`);

  // 一题未评的那一份：服务端 404，service 回空壳而不是抛。
  const empty = await assess.getChildAssessment(EMPTY_CHILD);
  check(`child ${EMPTY_CHILD} 一题未评时回空壳（completedCount 0，不是抛错）`,
    empty.completedCount === 0 && empty.state === 'miss', JSON.stringify(empty.state));
  check('空壳的 avg 是「—」，不是 0.0', empty.avg === '—', empty.avg);
  check('空壳照样有 124 题可填',
    empty.domains.reduce((n, d) => n + d.items.length, 0) === 124,
    `实际 ${empty.domains.reduce((n, d) => n + d.items.length, 0)} 题`);

  const rawOne = await api_get(`/children/${DRAFT_CHILD}/child-assessment`);
  if (rawOne.child_name === undefined) {
    note(
      'GET /children/{child_id}/child-assessment 不回 `child_name`（契约的 ChildAssessmentDetail 继承了它）。',
      `实测回包的键：${Object.keys(rawOne).join(', ')}；routes/teacher.mjs 是 \`SELECT a.*\`，`
      + ' 本表没有 child_name 列，也没有 JOIN db_child。'
      + ' 填写页与报告页的姓名因此从上一层（进度表）经 URL 带过来。'
      + ' 解封：回包带上 child_name。归 #30。',
    );
  } else {
    check('GET 单条回了 child_name', true);
  }

  /* ── 写：逐题 UPSERT ─────────────────────────────────────────────────── */

  const beforeRow = await caRow(EMPTY_CHILD);
  made.push({
    kind: 'caRow',
    childAssessmentId: beforeRow.child_assessment_id,
    completed_count: beforeRow.completed_count,
    child_assessment_status: beforeRow.child_assessment_status,
    submitted_at: beforeRow.submitted_at,
  });
  made.push({
    kind: 'caItem',
    childAssessmentId: beforeRow.child_assessment_id,
    itemId: 'K1-1-1',
    existed: false,
    score: null,
  });

  const fresh = await assess.scoreItem(EMPTY_CHILD, 'K1-1-1', 4);
  const afterRow = await caRow(EMPTY_CHILD);
  check('打一题分之后库里多了一行题项',
    afterRow.real_items === beforeRow.real_items + 1,
    `${beforeRow.real_items} → ${afterRow.real_items}`);
  const scoreCell = await db.query(
    'SELECT score FROM db_child_assessment_item WHERE child_assessment_id=$1 AND item_id=$2',
    [beforeRow.child_assessment_id, 'K1-1-1']);
  check('那一行的 score 逐值落库为 4',
    scoreCell.rows[0] && scoreCell.rows[0].score === 4,
    `实际 ${scoreCell.rows[0] ? scoreCell.rows[0].score : '(无行)'}`);
  check('库里的 completed_count 从 0 变成 1',
    afterRow.completed_count === 1, `实际 ${afterRow.completed_count}`);
  check('写完重取的 completedCount 是 1（不是回包的题项行）',
    fresh.completedCount === 1, `实际 ${fresh.completedCount}`);
  check('那一格在填写页上变成已评',
    fresh.domains.find((d) => d.id === 'K').items.find((i) => i.id === 'K1-1-1').rated === true,
    '那一格还是未评');
  check('K 领域的 scoreText 变成「1/23 · 平均 4.0」',
    fresh.domains.find((d) => d.id === 'K').scoreText === '1/23 · 平均 4.0',
    fresh.domains.find((d) => d.id === 'K').scoreText);
  check('状态仍是 c2（1/124 不算完成）',
    afterRow.child_assessment_status === 'c2', `实际 ${afterRow.child_assessment_status}`);

  // 同一题再打一次：UPSERT，行数不变，分改掉。
  await assess.scoreItem(EMPTY_CHILD, 'K1-1-1', 2);
  const again = await caRow(EMPTY_CHILD);
  const cell2 = await db.query(
    'SELECT score FROM db_child_assessment_item WHERE child_assessment_id=$1 AND item_id=$2',
    [beforeRow.child_assessment_id, 'K1-1-1']);
  check('同一题再打一次是 UPSERT：行数不变', again.real_items === 1, `实际 ${again.real_items}`);
  check('同一题再打一次把分改成 2',
    cell2.rows[0] && cell2.rows[0].score === 2, `实际 ${cell2.rows[0] && cell2.rows[0].score}`);
  check('completed_count 仍是 1（不是 2）', again.completed_count === 1, `实际 ${again.completed_count}`);

  /* ── 拒绝集：拒之后库里那一行没变（§7.5）────────────────────────────── */

  await refusesScore('score 为 0', EMPTY_CHILD, 'K1-1-2', 0, 'validation_failed');
  await refusesScore('score 为 6', EMPTY_CHILD, 'K1-1-2', 6, 'validation_failed');
  await refusesScore('题号不在量表里', EMPTY_CHILD, 'ZZ9-9-9', 3, 'validation_failed');
  const otherChild = (await db.query(
    "SELECT child_id FROM db_child WHERE class_id <> $1 AND enrollment_status='e1' ORDER BY child_id LIMIT 1",
    [CLASS_ID])).rows[0].child_id;
  await refusesScore(`别班 child ${otherChild}`, otherChild, 'K1-1-2', 3, 'not_found');

  // 已 c1 的那一份改分：契约说 score_item 是 reversible，服务端只找 c2 的主记录。
  const doneBefore = await caRow(C1_CHILD);
  let code = '(没被拒)';
  try {
    await assess.scoreItem(C1_CHILD, 'H1-1-1', 3);
  } catch (err) { code = err.code; }
  const doneAfter = await caRow(C1_CHILD);
  check(`拒之后 child ${C1_CHILD} 的 completed_count 没变（仍 124）`,
    doneAfter.completed_count === doneBefore.completed_count,
    `${doneBefore.completed_count} → ${doneAfter.completed_count}`);
  check(`拒之后 child ${C1_CHILD} 的状态没变（仍 c1）`,
    doneAfter.child_assessment_status === doneBefore.child_assessment_status,
    `${doneBefore.child_assessment_status} → ${doneAfter.child_assessment_status}`);
  if (code === 'not_found') {
    note(
      'PUT /children/{child_id}/child-assessment/items/{item_id} 对已完成（c1）的那一份回 404，'
      + '而契约的 child_assessment.score_item 是 reversible（登记表 reversible 列）。',
      `child ${C1_CHILD}（124 题 c1）改一题分回 not_found；routes/teacher.mjs 的 WHERE 只找`
      + " child_assessment_status='c2' 的主记录。库里那一行确认一个字没变（不是回 404 却真写了）。"
      + ' 影响：综合评估结果页的「继续评估」对已完成的幼儿点下去必然失败，'
      + ' 页面已按 service 的 state 进只读态。解封：c1 的那一份也能改分。归 #30。',
    );
  } else {
    check(`已完成的那一份可以改分（reversible）`, code === '(没被拒)', `实际 ${code}`);
  }

  const rawPut = await api.put(`/children/${EMPTY_CHILD}/child-assessment/items/K1-1-1`, {
    action: 'child_assessment.score_item', body: { score: 2 },
  });
  if (rawPut && rawPut.child_assessment_item_id !== undefined) {
    note(
      'PUT .../child-assessment/items/{item_id} 回的是题项行 { child_assessment_item_id, item_id, score }，'
      + '契约要回 ChildAssessmentProgress（含 completed_count 与状态）。',
      `实测回包的键：${Object.keys(rawPut).join(', ')}；routes/teacher.mjs 的 RETURNING 就是这三列。`
      + ' service 因此【不用回包】，写完重新 GET 一次进度 —— 多一次往返，'
      + ' 换掉一个会在服务端修好那天悄悄变形的分支。'
      + ' 解封：回包是 ChildAssessmentProgress。归 #30。',
    );
  } else {
    check('PUT 回的是 ChildAssessmentProgress',
      rawPut && rawPut.completed_count !== undefined, JSON.stringify(rawPut));
  }
}

/** 断言某次逐题评分被拒，**且库里那一份一个字没变**（§7.5）。 */
async function refusesScore(label, childId, itemId, score, expectCode) {
  const before = await caRow(childId);
  let code = '(没被拒)';
  try {
    await assess.scoreItem(childId, itemId, score);
  } catch (err) { code = err.code; }
  check(`${label} 回 ${expectCode}`, code === expectCode, `实际 ${code}`);
  const after = await caRow(childId);
  check(`${label} 之后题项行数没变（仍 ${before && before.real_items}）`,
    (after && after.real_items) === (before && before.real_items),
    `${before && before.real_items} → ${after && after.real_items}`);
  check(`${label} 之后 completed_count 没变`,
    (after && after.completed_count) === (before && before.completed_count),
    `${before && before.completed_count} → ${after && after.completed_count}`);
}

/* ── 组 4 · 两张报告 ───────────────────────────────────────────────────── */

async function groupReport() {
  console.log('\n[report] 报告 —— GET /children/{id}/child-assessment/report, GET /child-assessments/class-report');

  /* 个人报告 */
  const rawOne = await api_get(`/children/${C1_CHILD}/child-assessment/report`);
  const shapeOk = Array.isArray(rawOne.domains)
    && rawOne.domains.every((d) => d.code !== undefined && d.average !== undefined)
    && rawOne.total_average !== undefined;
  if (!shapeOk) {
    note(
      'GET /children/{child_id}/child-assessment/report 的字段名与契约不同：回 `domain` / '
      + '`domain_score`，契约是 `code` / `average`；且**无 `total_average`、无 `items`、'
      + '无 `scale_code` / `scale_version` / `submitted_at`**。',
      `实测 domains[0] 的键：${Object.keys(rawOne.domains[0] || {}).join(', ')}；`
      + `外层的键：${Object.keys(rawOne).join(', ')}。`
      + ' routes/teacher.mjs 的 SELECT 是 `left(i.item_id,1) AS domain, round(avg(i.score),2) AS domain_score`。'
      + ' 客户端**不译字段名** —— 译一次就把契约的形状藏进客户端，服务端修好那天会静默坏掉。'
      + ' 所以 comprehensive-assessment-report 今天五个角全显示「未评」，'
      + ' 明细 tab 的 124 行全显示「未评」。那是照实少显示，不是编一个出来。'
      + ' 解封：本组下面五项 `check(领域 X 的 average 是 …)` 与 `total_average` 那一项变绿。归 #30。',
    );
    // domain_score 还是字符串且只到两位小数 —— 契约的 average 是 number。
    if (rawOne.domains[0] && typeof rawOne.domains[0].domain_score === 'string') {
      note(
        '个人报告的 `domain_score` 是**字符串**且只保留两位小数，契约的 `ScaleAggregate.average` 是 number。',
        `实测 domains[0].domain_score = ${JSON.stringify(rawOne.domains[0].domain_score)}；`
        + ` 库里题项级均值是 ${EXPECT_REPORT_7.A.average}（A 领域）。两位小数使 total_average`
        + ` 的题项级（${EXPECT_TOTAL_AVG_7}）与领域再平均（${WRONG_TOTAL_AVG_7}）无法在回包一侧区分。`
        + ' 解封：回 number 且不预先四舍五入。归 #30。',
      );
    }
  }

  const report = await assess.childAssessmentReport(C1_CHILD);
  check('个人报告的五个角次序是 健康 语言 社会 科学 艺术',
    report.legend.map((d) => d.label).join(',') === '健康,语言,社会,科学,艺术',
    report.legend.map((d) => d.label).join(','));
  check('averages 是 5 个位置的数组（radar.js 的签名不变）',
    Array.isArray(report.averages) && report.averages.length === 5,
    `实际 ${JSON.stringify(report.averages)}`);

  // 逐领域钉到库里那个数（四位小数）。服务端漂移时这几项会失败 —— 所以只在
  // 形状对得上时才 check，形状不对已经用 note 登记过了。
  const dbDomains = await db.query(
    `SELECT left(i.item_id,1) AS code, count(*)::int AS item_count, avg(i.score) AS average
       FROM db_child_assessment_item i JOIN db_child_assessment a USING (child_assessment_id)
      WHERE a.child_id=$1 AND a.term_id=$2 GROUP BY 1 ORDER BY 1`,
    [C1_CHILD, CURRENT_TERM]);
  for (const row of dbDomains.rows) {
    check(`库里 child ${C1_CHILD} 的 ${row.code} 领域是 ${row.item_count} 题、均分 ${Number(row.average).toFixed(4)}`,
      row.item_count === EXPECT_REPORT_7[row.code].item_count
      && near(row.average, EXPECT_REPORT_7[row.code].average),
      `实际 ${row.item_count} 题 / ${Number(row.average).toFixed(4)}`);
  }
  const dbTotal = await scalar(
    `SELECT avg(i.score) FROM db_child_assessment_item i
       JOIN db_child_assessment a USING (child_assessment_id)
      WHERE a.child_id=$1 AND a.term_id=$2`, [C1_CHILD, CURRENT_TERM]);
  check(`库里 child ${C1_CHILD} 的题项级全卷均分是 ${EXPECT_TOTAL_AVG_7}`,
    near(dbTotal, EXPECT_TOTAL_AVG_7, 6), `实际 ${Number(dbTotal).toFixed(6)}`);
  const naive = Object.values(EXPECT_REPORT_7).reduce((a, d) => a + d.average, 0) / 5;
  check(`「五个领域均分再平均」是 ${WRONG_TOTAL_AVG_7} —— 与题项级不同，两个算法能分开`,
    !near(naive, EXPECT_TOTAL_AVG_7, 4) && near(naive, WRONG_TOTAL_AVG_7, 4),
    `再平均 ${naive.toFixed(6)}`);

  if (shapeOk) {
    for (const code of Object.keys(EXPECT_REPORT_7)) {
      const got = report.legend.find((d) => d.code === code);
      check(`个人报告 ${code} 领域的 average 是 ${EXPECT_REPORT_7[code].average}`,
        got && near(got.average, EXPECT_REPORT_7[code].average),
        `实际 ${got && got.average}`);
    }
    check(`个人报告的 totalAverage 是题项级的 ${EXPECT_TOTAL_AVG_7}，不是再平均的 ${WRONG_TOTAL_AVG_7}`,
      near(report.totalAverage, EXPECT_TOTAL_AVG_7, 6), `实际 ${report.totalAverage}`);
  } else {
    check('字段名对不上时 average 一律 null，客户端不补 0 分',
      report.legend.every((d) => d.average === null), JSON.stringify(report.averages));
    check('字段名对不上时图例一律显示「未评」，不显示 0.0',
      report.legend.every((d) => d.averageLabel === '未评'), JSON.stringify(report.legend));
    check('字段名对不上时 totalAverageLabel 是「—」，不是 0.0',
      report.totalAverageLabel === '—', report.totalAverageLabel);
  }

  // 草稿那一份：K 与 A 整域未评，契约要 average null / item_count 0，不得回 0 分。
  const rawDraft = await api_get(`/children/${DRAFT_CHILD}/child-assessment/report`);
  const codes = (rawDraft.domains || []).map((d) => d.code || d.domain);
  if (!codes.includes('K') || !codes.includes('A')) {
    note(
      '草稿那一份的报告里 K 与 A 两个整域**整行缺席**，契约要 `average: null` 且 `item_count: 0`。',
      `child ${DRAFT_CHILD}（62 题草稿，K 与 A 一题未评）的 domains 只回 ${codes.join(',')} 三行；`
      + ' routes/teacher.mjs 的 GROUP BY left(item_id,1) 只对有分的题分组，没分的领域不成行。'
      + ' 客户端的 decorateDomains 按 DOMAIN_ORDER 铺满五个位置、缺席的给 null'
      + '（**不给 0 分**），所以页面上那两个角照实显示「未评」。'
      + ' 解封：回包五行齐、缺席的 average 为 null。归 #30。',
    );
  } else {
    check('草稿的 K 与 A 回了 average null', true);
  }
  const draftReport = await assess.childAssessmentReport(DRAFT_CHILD);
  check('草稿的报告照样铺满 5 个角（缺席的补 null，不补 0）',
    draftReport.legend.length === 5
    && draftReport.legend.filter((d) => d.average === null).length >= 2,
    JSON.stringify(draftReport.averages));
  check('草稿的 K 与 A 显示「未评」，不显示 0.0',
    ['K', 'A'].every((c) => draftReport.legend.find((d) => d.code === c).averageLabel === '未评'),
    JSON.stringify(draftReport.legend));

  /* 班级报告 */
  const rawClass = await api_get('/child-assessments/class-report');
  const classShapeOk = rawClass.assessed_child_count !== undefined
    && Array.isArray(rawClass.domains);
  if (!classShapeOk) {
    const perChild = new Set((rawClass.items || []).map((r) => r.child_id));
    note(
      'GET /child-assessments/class-report 回的是**逐幼儿逐领域行** '
      + '`{items:[{child_id, child_name, domain, domain_score}]}`，'
      + '契约要 ChildAssessmentClassReport（`class_id` / `term_id` / '
      + '`assessed_child_count` / `domains[]`）；**且不过滤 c1**。',
      `实测外层的键：${Object.keys(rawClass).join(', ')}；`
      + `items 覆盖 ${perChild.size} 名幼儿（含草稿与一题未评的），`
      + `而只统计 c1 时样本量应是 2（child ${C1_CHILD} 与 child 9）。`
      + ' routes/teacher.mjs 的 SQL 里没有 child_assessment_status=\'c1\'，也没有聚合到班级。'
      + ' **客户端不补这个过滤** —— 补一遍等于把范围判定搬到客户端，'
      + ' 那时候「服务端漏了过滤」就再也没人会发现。'
      + ' 解封：本组下面 `assessed_child_count 是 2` 与五个 `item_count` 那几项变绿。归 #30。',
    );
  }

  const dbClass = await db.query(
    `SELECT left(i.item_id,1) AS code, count(*)::int AS item_count, avg(i.score) AS average
       FROM db_child_assessment_item i JOIN db_child_assessment a USING (child_assessment_id)
      WHERE a.class_id=$1 AND a.term_id=$2 AND a.child_assessment_status='c1'
      GROUP BY 1 ORDER BY 1`, [CLASS_ID, CURRENT_TERM]);
  for (const row of dbClass.rows) {
    check(`库里班级报告 ${row.code} 领域是 ${row.item_count} 题、均分 ${Number(row.average).toFixed(4)}`,
      row.item_count === EXPECT_CLASS_REPORT[row.code].item_count
      && near(row.average, EXPECT_CLASS_REPORT[row.code].average),
      `实际 ${row.item_count} 题 / ${Number(row.average).toFixed(4)}`);
  }
  const dbAssessed = await scalar(
    "SELECT count(*)::int FROM db_child_assessment WHERE class_id=$1 AND term_id=$2 AND child_assessment_status='c1'",
    [CLASS_ID, CURRENT_TERM]);
  check('库里当前学期只有 2 名幼儿是 c1（班级报告的样本量）',
    dbAssessed === 2, `实际 ${dbAssessed} 名`);
  // 草稿混进分母的话 H 会从 72 题变成 72+36×4=216 题那一类的数。
  const dbWithDrafts = await scalar(
    `SELECT count(*)::int FROM db_child_assessment_item i
       JOIN db_child_assessment a USING (child_assessment_id)
      WHERE a.class_id=$1 AND a.term_id=$2 AND left(i.item_id,1)='H'`,
    [CLASS_ID, CURRENT_TERM]);
  check(`草稿混进来时 H 领域会是 ${dbWithDrafts} 题，只算 c1 时是 72 题 —— 两个数分得开`,
    dbWithDrafts !== 72, `实际 ${dbWithDrafts}`);

  const classReport = await assess.classReport();
  check('班级报告的分母是名册长度（契约只给分子）',
    classReport.rosterCount === CLASS_SIZE, `实际 ${classReport.rosterCount}`);
  if (classShapeOk) {
    check('assessed_child_count 是 2（只统计 c1）',
      classReport.assessedChildCount === 2, `实际 ${classReport.assessedChildCount}`);
    check('doneRatio 是 2/10', classReport.doneRatio === `2/${CLASS_SIZE}`, classReport.doneRatio);
    for (const code of Object.keys(EXPECT_CLASS_REPORT)) {
      const got = classReport.legend.find((d) => d.code === code);
      check(`班级报告 ${code} 领域的 item_count 是 ${EXPECT_CLASS_REPORT[code].item_count}`,
        got && got.itemCount === EXPECT_CLASS_REPORT[code].item_count,
        `实际 ${got && got.itemCount}`);
      check(`班级报告 ${code} 领域的 average 是 ${EXPECT_CLASS_REPORT[code].average}`,
        got && near(got.average, EXPECT_CLASS_REPORT[code].average), `实际 ${got && got.average}`);
    }
  } else {
    // **「字段缺席」与「服务端说 0 份」是两件事，这里两头都钉。**
    // 折成 0 会在屏幕上写出「已完成 0/10」，而库里 child 7 与 child 9 确实是 c1，
    // 真值是 2/10 —— 那是显示一个错的数，比少显示糟。
    check('样本量缺席时是 null，不折成 0',
      classReport.assessedChildCount === null,
      `实际 ${JSON.stringify(classReport.assessedChildCount)}`);
    check('缺席不是空 —— empty 为假，unknownAssessed 为真',
      classReport.empty === false && classReport.unknownAssessed === true,
      JSON.stringify({ empty: classReport.empty, unknown: classReport.unknownAssessed }));
    check('比例显示「—/10」，不显示「0/10」',
      classReport.doneRatio === `—/${classReport.rosterCount}`, classReport.doneRatio);
    check('heroNote 照实说「服务端暂未回已完成份数」，不谎报「暂无已完成的评估」',
      /暂未回/.test(classReport.heroNote) && !/暂无已完成的评估/.test(classReport.heroNote),
      classReport.heroNote);
    check('空态的五个角一律 null，不补 0 分',
      classReport.averages.every((a) => a === null), JSON.stringify(classReport.averages));
  }
  check('班级报告的五个角次序也是 健康 语言 社会 科学 艺术',
    classReport.legend.map((d) => d.label).join(',') === '健康,语言,社会,科学,艺术',
    classReport.legend.map((d) => d.label).join(','));
}

/* ── 组 5 · 办园质量评估 ───────────────────────────────────────────────── */

/** 库里那一份的裸值 + **有分的题项行数**（契约的 completed_count 就是这个数）。 */
async function asmtRow(id) {
  const r = await db.query(
    `SELECT a.assessment_id, a.assessment_scope, a.assessment_period,
            a.tool_code, a.tool_version, a.required_count, a.completed_count,
            a.assessment_status, a.submitted_at,
            (SELECT count(*)::int FROM db_assessment_item i
              WHERE i.assessment_id = a.assessment_id AND i.score IS NOT NULL) AS real_scored
       FROM db_assessment a WHERE a.assessment_id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

async function asmtItem(id, code) {
  const r = await db.query(
    'SELECT item_id, score, note FROM db_assessment_item WHERE assessment_id=$1 AND tool_item_code=$2',
    [id, code],
  );
  return r.rows[0] || null;
}

async function groupQuality() {
  console.log('\n[quality] 质量评估 —— GET /assessments, GET /assessments/{id}, PUT .../items/{code}');

  const DATA = require_(resolve(MP, 'pages', 'assessment-tool', 'assessment-data.js'));
  check('assessment-data.js 有 120 条指标（F17 的代码资产，一个字不改）',
    DATA.indicators.length === 120, `实际 ${DATA.indicators.length} 条`);
  check('第一条指标的 code 是 I001，与库里 tool_item_code 逐字相同',
    DATA.indicators[0].code === 'I001', DATA.indicators[0].code);
  // 比的是**打满 120 题的那一份**（assessment 1，s3）。可写的那一份只有 109 行 ——
  // 未评的题**根本没有行**，不是「有行但 score 为 null」，这一点下面还要用一次。
  const dbCodes = (await db.query(
    'SELECT tool_item_code FROM db_assessment_item WHERE assessment_id=$1 ORDER BY tool_item_code',
    [ASMT_DONE])).rows.map((r) => r.tool_item_code);
  const localCodes = DATA.indicators.map((i) => i.code).sort();
  check('库里那 120 个 tool_item_code 与包内的 120 个 code 逐字相同（不用换算）',
    dbCodes.join(',') === localCodes.join(','),
    `库里 ${dbCodes.length} 个 / 包内 ${localCodes.length} 个，首个差异 `
    + `${dbCodes.find((c, i) => c !== localCodes[i]) || '(无)'}`);
  const writableCodes = (await db.query(
    'SELECT tool_item_code FROM db_assessment_item WHERE assessment_id=$1', [ASMT_WRITABLE]
  )).rows.map((r) => r.tool_item_code);
  check(`assessment ${ASMT_WRITABLE} 库里只有 109 行题项（未评的 11 题一行都没有）`,
    writableCodes.length === 109, `实际 ${writableCodes.length} 行`);

  const page = await assess.listAssessments({ limit: 20 });
  check('教师 1 有三份质量评估', page.items.length === 3, `实际 ${page.items.length} 份`);
  check('三份的 id 是 7 / 13 / 1（契约排序 period DESC, id DESC，客户端不重排）',
    page.items.map((a) => a.id).join(',') === '7,13,1', page.items.map((a) => a.id).join(','));
  const first = page.items[0];
  check('第一份是 2026-04 那一期', first.period === '2026-04', first.period);
  check('第一份 109/120', first.completedCount === 109 && first.requiredCount === 120,
    `${first.completedCount}/${first.requiredCount}`);
  check('第一份状态是 s2，中文是「进行中」',
    first.status === 's2' && first.statusLabel === '进行中', `${first.status}/${first.statusLabel}`);
  check('第一份 can.score 为真（s2 可写）', first.can.score === true, JSON.stringify(first.can));
  check('a2 译成「班级」', first.scopeLabel === '班级', first.scopeLabel);
  const done = page.items.find((a) => a.id === ASMT_DONE);
  check(`assessment ${ASMT_DONE} 状态是 s3，中文是「已完成」`,
    done.status === 's3' && done.statusLabel === '已完成', `${done.status}/${done.statusLabel}`);
  check(`assessment ${ASMT_DONE} 的 can.score 为假（s3 进只读态）`,
    done.can.score === false, JSON.stringify(done.can));
  check('a3 译成「园所」', page.items.find((a) => a.id === 13).scopeLabel === '园所',
    page.items.find((a) => a.id === 13).scopeLabel);

  // 逐份钉到库里，且 completed_count 与「有分的行数」两头钉。
  for (const card of page.items) {
    const dbRow = await asmtRow(card.id);
    check(`assessment ${card.id} 的 completedCount 与库里那一列相同`,
      card.completedCount === dbRow.completed_count,
      `回包 ${card.completedCount} / 库 ${dbRow.completed_count}`);
    check(`assessment ${card.id} 库里 completed_count 等于有分的题项行数`,
      dbRow.completed_count === dbRow.real_scored,
      `列 ${dbRow.completed_count} / 行 ${dbRow.real_scored}`);
  }

  // 范围两头钉：别的教师那几份一个都不在里面。
  const ids = page.items.map((a) => a.id);
  const otherIds = (await db.query(
    'SELECT assessment_id FROM db_assessment WHERE teacher_id <> 1')).rows.map((r) => r.assessment_id);
  check('别的教师那几份一个都没漏进来',
    otherIds.every((id) => !ids.includes(id)),
    `漏了 ${otherIds.filter((id) => ids.includes(id)).join(',')}`);
  check('库里教师 1 名下正好三份（回包没有少给）',
    (await scalar('SELECT count(*)::int FROM db_assessment WHERE teacher_id=1')) === 3, '数不对');

  if (page.nextCursor === null && page.items.length === 3) {
    note(
      'GET /assessments **完全忽略 `limit` 与 `cursor`**（13 条端点里唯一分页的一条），恒回 `next_cursor: null`。',
      'limit=2 时仍回 3 条（实测）；routes/teacher.mjs 的 listAssessments 不读这两个参数。'
      + ' service 仍走 api.getPage（契约的形状），拿到 nextCursor 为 null 就当到底。'
      + ' 教师 1 只有三份，今天不咬人。解封：limit=2 回 2 条 + 一个非空 cursor。归 #30。',
    );
  } else {
    check('GET /assessments 认 limit', page.items.length === 2, `实际 ${page.items.length} 条`);
  }

  /* 详情 */
  const detail = await assess.getAssessment(ASMT_WRITABLE, DATA.scoring.levels);
  check('详情按 tool_item_code 索引，I001 查得到',
    detail.items.has('I001'), `键的样本：${[...detail.items.keys()].slice(0, 3).join(',')}`);
  const i001 = await asmtItem(ASMT_WRITABLE, 'I001');
  check(`I001 的分与库里那一行相同（库里是 ${i001.score}）`,
    detail.items.get('I001').score === i001.score, `实际 ${detail.items.get('I001').score}`);
  check('得分率与等级算得出来（纯客户端派生，契约里没有这两样）',
    detail.summary.rated === 109 && detail.summary.percent !== null,
    JSON.stringify(detail.summary));
  const dbSum = await scalar(
    'SELECT avg(score) FROM db_assessment_item WHERE assessment_id=$1 AND score IS NOT NULL',
    [ASMT_WRITABLE]);
  check(`得分率与库里重算的一致（${Math.round((Number(dbSum) / 5) * 100)}%）`,
    detail.summary.percent === Math.round((Number(dbSum) / 5) * 100),
    `回包 ${detail.summary.percent}% / 库 ${Math.round((Number(dbSum) / 5) * 100)}%`);
  const rawDetail = await api_get(`/assessments/${ASMT_WRITABLE}`);
  const sampleItem = (rawDetail.items || [])[0] || {};
  if (sampleItem.file_id === undefined) {
    note(
      'GET /assessments/{assessment_id} 的 items 不回 `file_id[]`（契约的 AssessmentItem 有这一项，'
      + '派生自 db_file_ref owner_object=db_assessment_item usage_key=evidence）。',
      `实测 items[0] 的键：${Object.keys(sampleItem).join(', ')}；routes/teacher.mjs 的 SELECT`
      + ' 只取 tool_item_code / score / note。因此 assessment-tool 的佐证图片本轮不接，'
      + ' 入口置灰。解封：items 带上 file_id[]。归 #30。',
    );
  } else {
    check('详情的 items 回了 file_id[]', true);
  }

  /* 写：score 与 note 两头钉 */
  const before = await asmtRow(ASMT_WRITABLE);
  const beforeItem = await asmtItem(ASMT_WRITABLE, 'I001');
  made.push({
    kind: 'asmtItem',
    assessmentId: ASMT_WRITABLE,
    toolItemCode: 'I001',
    existed: Boolean(beforeItem),
    score: beforeItem ? beforeItem.score : null,
    note: beforeItem ? beforeItem.note : null,
  });
  made.push({
    kind: 'asmtRow',
    assessmentId: ASMT_WRITABLE,
    completed_count: before.completed_count,
    assessment_status: before.assessment_status,
    submitted_at: before.submitted_at,
  });

  const NOTE = `probe-assessment 评价记录 ${Date.now()}`;
  await assess.scoreAssessmentItem(ASMT_WRITABLE, 'I001', { score: 3, note: NOTE });
  const afterItem = await asmtItem(ASMT_WRITABLE, 'I001');
  check('score 逐值落库为 3', afterItem.score === 3, `实际 ${afterItem.score}`);
  // 断言值，不断言形状（§7.6）：note 不回包，只看回包会把「没落库」读成「没这个字段」。
  if (afterItem.note !== NOTE) {
    note(
      'PUT /assessments/{id}/items/{tool_item_code} **不写 `note`** —— 请求体读进来就丢。'
      + '这是**数据损失**，不是显示问题：教师写的评价记录提交即消失，而页面会显示成功。',
      `发了 note=${JSON.stringify(NOTE)}，库里那一行的 note 是 ${JSON.stringify(afterItem.note)}；`
      + ' routes/teacher.mjs 的 INSERT 只有 (assessment_id, tool_item_code, score) 三列，'
      + " ON CONFLICT DO UPDATE 也只 SET score。库里 1176 行 note 非空 0 行（实测）。"
      + ' service 照契约把 note 发上去（发对了，服务端修好那天不用改客户端）；'
      + ' assessment-tool 同时把它存在本机并在输入框旁标明「评价记录暂存本机」。'
      + " 解封：这一项的 `check('note 逐字落库')` 变绿。归 #30。",
    );
  } else {
    check('note 逐字落库', true);
  }

  const afterRow = await asmtRow(ASMT_WRITABLE);
  check('库里有分的题项行数没变（I001 本来就有分，这是 UPSERT）',
    afterRow.real_scored === before.real_scored,
    `${before.real_scored} → ${afterRow.real_scored}`);
  if (afterRow.completed_count === before.completed_count
      && afterRow.assessment_status === before.assessment_status) {
    // 这一份的 I001 本来有分，所以 completed_count 本就不该变。换一题**库里还没有行**
    // 的来钉 —— 未评 = 无行，所以这一次是真的 INSERT，`completed_count` 该跟着涨。
    const blankCode = DATA.indicators
      .map((i) => i.code)
      .find((c) => !writableCodes.includes(c));
    check('可写那一份里找得出一题还没有行的（未评 = 无行）',
      Boolean(blankCode), '120 题全有行了');
    if (blankCode) {
      made.push({
        kind: 'asmtItem',
        assessmentId: ASMT_WRITABLE,
        toolItemCode: blankCode,
        existed: false,
        score: null,
        note: null,
      });
      await assess.scoreAssessmentItem(ASMT_WRITABLE, blankCode, { score: 4 });
      const grew = await asmtRow(ASMT_WRITABLE);
      check(`给没有行的 ${blankCode} 打分之后库里有分的行数变成 110`,
        grew.real_scored === before.real_scored + 1,
        `${before.real_scored} → ${grew.real_scored}`);
      if (grew.completed_count === before.completed_count) {
        note(
          'PUT /assessments/{id}/items/{code} **完全不更新 `db_assessment`** —— `completed_count` 与 '
          + '`assessment_status` 打完分永远不动（契约要回 Assessment，且 status 由 completed_count 派生）。',
          `给 ${blankCode} 打了一分，库里有分的行数 ${before.real_scored} → ${grew.real_scored}，`
          + ` 而 completed_count 仍是 ${grew.completed_count}、status 仍是 ${grew.assessment_status}；`
          + ' routes/teacher.mjs 那一段里没有任何 UPDATE db_assessment。'
          + ' 页面上的「已评 N/120」因此只反映本次会话打过的题，退出重进会回到 109。'
          + ' 解封：completed_count 随打分递增，s1→s2→s3 跟着走。归 #30。',
        );
      } else {
        check('completed_count 随打分从 109 变成 110',
          grew.completed_count === before.completed_count + 1, `实际 ${grew.completed_count}`);
      }
    }
  }

  const rawPut = await api.put(`/assessments/${ASMT_WRITABLE}/items/I001`, {
    action: 'assessment.score_item', body: { score: 3 },
  });
  if (rawPut && rawPut.tool_item_code !== undefined && rawPut.assessment_status === undefined) {
    note(
      'PUT /assessments/{id}/items/{code} 回的是**题项行**，契约要回 `Assessment`（整份的计数与状态）。',
      `实测回包的键：${Object.keys(rawPut).join(', ')}。`
      + ' service 因此不用回包判进度，页面的计数自己维护本次会话的增量。'
      + ' 解封：回包是 Assessment。归 #30。',
    );
  } else {
    check('PUT 回的是 Assessment', rawPut && rawPut.assessment_status !== undefined,
      JSON.stringify(rawPut));
  }

  /* 拒绝集：拒之后库里那一份没变（§7.5）*/
  await refusesAsmt(`给已完成的 assessment ${ASMT_DONE} 打分`, ASMT_DONE, 'I001', 3, 'not_found');
  await refusesAsmt('score 为 6', ASMT_WRITABLE, 'I002', 6, 'validation_failed');
  // score 为 null：契约的 AssessmentItemWrite.score 必填 integer 1..5。
  const nullBefore = await asmtItem(ASMT_WRITABLE, 'I002');
  let nullCode = '(没被拒)';
  try {
    await api.put(`/assessments/${ASMT_WRITABLE}/items/I002`, {
      action: 'assessment.score_item', body: { score: null },
    });
  } catch (err) { nullCode = err.code; }
  const nullAfter = await asmtItem(ASMT_WRITABLE, 'I002');
  if (nullCode === '(没被拒)') {
    made.push({
      kind: 'asmtItem',
      assessmentId: ASMT_WRITABLE,
      toolItemCode: 'I002',
      existed: true,
      score: nullBefore.score,
      note: nullBefore.note,
    });
    note(
      'PUT /assessments/{id}/items/{code} **接受 `score: null` 并把已有的分抹掉**，'
      + '而契约的 `AssessmentItemWrite.score` 是必填 integer 1..5（读写值域不对称是刻意的：'
      + '不能用 PUT 把分抹掉）。',
      `发 { score: null } 回 200，库里 I002 的分从 ${nullBefore.score} 变成 `
      + `${JSON.stringify(nullAfter.score)}；routes/teacher.mjs 的校验规则写的是 range_1_5_or_null。`
      + ' 这是**数据损失**：一次误发就抹掉一题的评分。'
      + ' service 的 scoreAssessmentItem 只发 Number(score)，客户端发不出 null；'
      + ' assessment-tool 的「再点一次取消评分」也已经去掉。'
      + ' 解封：score 为 null 回 422 且库里那一行不变。归 #30。',
    );
  } else {
    check('score 为 null 被拒（422）', nullCode === 'validation_failed', `实际 ${nullCode}`);
    check('拒之后 I002 的分没变',
      nullAfter.score === nullBefore.score, `${nullBefore.score} → ${nullAfter.score}`);
  }

  /* 预检 */
  check('score 为 0 预检不通过',
    assess.whyCannotScoreAssessmentItem({ score: 0 }) !== '', '0 分竟然放行了');
  check('score 为 6 预检不通过',
    assess.whyCannotScoreAssessmentItem({ score: 6 }) !== '', '6 分竟然放行了');
  check('301 字的评价记录预检不通过',
    assess.whyCannotScoreAssessmentItem({ score: 3, note: 'x'.repeat(301) }) !== '', '超框放行了');
  check('300 字的评价记录预检通过',
    assess.whyCannotScoreAssessmentItem({ score: 3, note: 'x'.repeat(300) }) === '', '刚好 300 字被挡了');
}

/** 断言某次质量评估打分被拒，**且库里那一份一个字没变**（§7.5）。 */
async function refusesAsmt(label, assessmentId, code, score, expectCode) {
  const before = await asmtRow(assessmentId);
  const beforeItem = await asmtItem(assessmentId, code);
  let got = '(没被拒)';
  try {
    await assess.scoreAssessmentItem(assessmentId, code, { score });
  } catch (err) { got = err.code; }
  check(`${label} 回 ${expectCode}`, got === expectCode, `实际 ${got}`);
  const after = await asmtRow(assessmentId);
  const afterItem = await asmtItem(assessmentId, code);
  check(`${label} 之后 completed_count 没变（仍 ${before.completed_count}）`,
    after.completed_count === before.completed_count,
    `${before.completed_count} → ${after.completed_count}`);
  check(`${label} 之后状态没变（仍 ${before.assessment_status}）`,
    after.assessment_status === before.assessment_status,
    `${before.assessment_status} → ${after.assessment_status}`);
  check(`${label} 之后 ${code} 那一行的分没变`,
    (afterItem && afterItem.score) === (beforeItem && beforeItem.score),
    `${beforeItem && beforeItem.score} → ${afterItem && afterItem.score}`);
}

/* ── 组 6 · 题库跨源比对 ───────────────────────────────────────────────── */

async function groupScale() {
  console.log('\n[scale] 题库 —— GET /scales/{scale_code}/{scale_version} 与包内那一份逐题比');

  const bank = flatDomains();
  check('包内题库 124 题', assess.scaleItemCount() === 124, `实际 ${assess.scaleItemCount()}`);
  for (const code of Object.keys(EXPECT_DOMAIN_SIZE)) {
    const d = bank.find((x) => x.id === code);
    check(`包内 ${code} 领域 ${EXPECT_DOMAIN_SIZE[code]} 题`,
      d && d.items.length === EXPECT_DOMAIN_SIZE[code], `实际 ${d && d.items.length}`);
  }
  const dbSizes = await db.query(
    "SELECT left(item_id,1) AS code, count(*)::int AS n FROM db_scale_item WHERE scale_code='guide-scale' AND scale_version='v1' GROUP BY 1");
  for (const row of dbSizes.rows) {
    check(`库里 ${row.code} 领域 ${EXPECT_DOMAIN_SIZE[row.code]} 题`,
      row.n === EXPECT_DOMAIN_SIZE[row.code], `实际 ${row.n}`);
  }

  const scale = await assess.getScale('guide-scale', 'v1');
  check('外壳的 scaleCode / scaleVersion 带得回来（服务端不回时由 path 参数补）',
    scale.scaleCode === 'guide-scale' && scale.scaleVersion === 'v1',
    `${scale.scaleCode}/${scale.scaleVersion}`);
  check('接口回 124 题', scale.items.length === 124, `实际 ${scale.items.length} 题`);

  const raw = await api_get('/scales/guide-scale/v1');
  if (raw.scale_code === undefined || raw.scale_version === undefined) {
    note(
      'GET /scales/{scale_code}/{scale_version} 没有 `scale_code` / `scale_version` 外壳'
      + '（契约的 Scale 两个都 required），且多回一个 `next_cursor`。',
      `实测外层的键：${Object.keys(raw).join(', ')}；routes/teacher.mjs 的 getScale 直接回`
      + ' { items, next_cursor }。service 从 path 参数自己带回来 —— 反正是它发出去的。'
      + ' 解封：回包带上这两个键。归 #30。',
    );
  } else {
    check('GET /scales 回了 scale_code 与 scale_version', true);
  }

  // 跨源比对：库里那 124 题与包内那一份逐题比。
  const byId = new Map(scale.items.map((it) => [it.item_id, it]));
  const flat = bank.reduce((acc, d) => acc.concat(d.items), []);
  check('题号集合逐个相同（库里 124 / 包内 124）',
    flat.every((q) => byId.has(q.id)) && byId.size === flat.length,
    `包内有而库里没有的：${flat.filter((q) => !byId.has(q.id)).map((q) => q.id).slice(0, 5).join(',')}`);
  const qDiff = flat.filter((q) => byId.has(q.id) && byId.get(q.id).question !== q.q);
  check('124 题的提问逐字相同',
    qDiff.length === 0, `对不上 ${qDiff.length} 题：${qDiff.slice(0, 3).map((q) => q.id).join(',')}`);
  const nameDiff = flat.filter((q) => byId.has(q.id) && byId.get(q.id).item_name !== q.name);
  check('124 题的题名逐字相同',
    nameDiff.length === 0, `对不上 ${nameDiff.length} 题：${nameDiff.slice(0, 3).map((q) => q.id).join(',')}`);
  const anchorDiff = flat.filter((q) => {
    const it = byId.get(q.id);
    if (!it || !it.anchors) return true;
    return ['1', '3', '5'].some((k) => it.anchors[k] !== q.a[k]);
  });
  check('124 题的三档锚点逐字相同',
    anchorDiff.length === 0,
    `对不上 ${anchorDiff.length} 题：${anchorDiff.slice(0, 3).map((q) => q.id).join(',')}`);
  const measured = scale.items.filter((it) => it.item_type === 'measurement');
  check('只有 H1-1-1 一题是 measurement',
    measured.length === 1 && measured[0].item_id === 'H1-1-1',
    `实际 ${measured.map((m) => m.item_id).join(',')}`);
  check('包内也只有 H1-1-1 一题带 m 标记',
    flat.filter((q) => q.m).map((q) => q.id).join(',') === 'H1-1-1',
    flat.filter((q) => q.m).map((q) => q.id).join(','));
  check('H1-1-1 的参考表在包内是 3 行（3~4 / 4~5 / 5~6 岁）',
    flat.find((q) => q.id === 'H1-1-1').ref.length === 3,
    `实际 ${flat.find((q) => q.id === 'H1-1-1').ref.length} 行`);
  if (scale.items.some((it) => it.reference_table !== undefined)) {
    check('接口回了 reference_table', true);
  } else {
    note(
      'GET /scales/... 不暴露 `reference_table`（G83 已登记；它多回了 `measurement_note`）。',
      `实测 H1-1-1 的键：${Object.keys(byId.get('H1-1-1') || {}).join(', ')}。`
      + ' 参考表因此只能从包内那一份取，而那一份有 npm test 第 7 段的闸门守着。'
      + ' 本票的页面本来就用包内题库，今天不咬人。解封：契约裁定要不要暴露它。归 G83。',
    );
  }
}

/* ── 主体 ───────────────────────────────────────────────────────────────── */

/** 直接打一次裸端点，用来钉「回包里到底有哪些键」。走的仍是 utils/request.js。 */
const api = require_(resolve(MP, 'utils', 'request.js'));
function api_get(path) { return api.get(path); }

const GROUPS = {
  growth: groupGrowth,
  term: groupTerm,
  child: groupChild,
  report: groupReport,
  quality: groupQuality,
  scale: groupScale,
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

async function main() {
  await db.connect();

  const c0 = await counts();
  check('六张表的行数与 STATS.md 的基线一致',
    c0.term_eval === BASE.term_eval && c0.child_assessment === BASE.child_assessment
    && c0.cai === BASE.cai && c0.growth_record === BASE.growth_record
    && c0.assessment === BASE.assessment && c0.assessment_item === BASE.assessment_item,
    `实际 ${JSON.stringify(c0)} / 期望 ${JSON.stringify(BASE)}`);

  const ctx = await guard.requireSession();
  check('登录后角色是 teacher', ctx.role === 'teacher', `实际 ${ctx.role}`);
  check(`会话的 scope 是 class ${CLASS_ID}`,
    ctx.scope && ctx.scope.class_id === CLASS_ID, JSON.stringify(ctx.scope));
  check(`会话的当前学期是 ${CURRENT_TERM}`,
    ctx.current_term && ctx.current_term.term_id === CURRENT_TERM,
    JSON.stringify(ctx.current_term));

  const roster = await co.classRoster();
  check(`本班在园名册 ${CLASS_SIZE} 名`, roster.length === CLASS_SIZE, `实际 ${roster.length} 名`);

  for (const name of requestedGroups()) {
    await GROUPS[name]();
  }
}

/**
 * 逐条还原。**行数回到基线不代表值回到基线** —— 本探针改的多半是既有行的 computed
 * 列（`completed_count` / 状态），行数对而计数从 124 变成 123，下一支探针就会莫名
 * 其妙地红。所以第 5 步单独把那几格再核一次。
 *
 * 还原顺序与写入顺序相反：先删本来无行的题项，再把主记录的计数写回去 ——
 * 反过来的话删题项那一步又会把计数改一次（服务端不参与，这里是裸 SQL，不会，
 * 但顺序仍照「后建的先收」写，避免以后加了触发器时出错）。
 */
async function restoreAll() {
  for (const m of made.slice().reverse()) {
    if (m.kind === 'termEval') {
      await db.query(
        `UPDATE db_term_eval SET eval_text=$2, term_eval_status=$3, submitted_at=$4
           WHERE term_eval_id=$1`,
        [m.termEvalId, m.eval_text, m.term_eval_status, m.submitted_at]);
    } else if (m.kind === 'caItem') {
      if (m.existed) {
        await db.query(
          'UPDATE db_child_assessment_item SET score=$3 WHERE child_assessment_id=$1 AND item_id=$2',
          [m.childAssessmentId, m.itemId, m.score]);
      } else {
        await db.query(
          'DELETE FROM db_child_assessment_item WHERE child_assessment_id=$1 AND item_id=$2',
          [m.childAssessmentId, m.itemId]);
      }
    } else if (m.kind === 'caRow') {
      await db.query(
        `UPDATE db_child_assessment SET completed_count=$2, child_assessment_status=$3, submitted_at=$4
           WHERE child_assessment_id=$1`,
        [m.childAssessmentId, m.completed_count, m.child_assessment_status, m.submitted_at]);
    } else if (m.kind === 'asmtItem') {
      if (m.existed) {
        await db.query(
          'UPDATE db_assessment_item SET score=$3, note=$4 WHERE assessment_id=$1 AND tool_item_code=$2',
          [m.assessmentId, m.toolItemCode, m.score, m.note]);
      } else {
        await db.query(
          'DELETE FROM db_assessment_item WHERE assessment_id=$1 AND tool_item_code=$2',
          [m.assessmentId, m.toolItemCode]);
      }
    } else if (m.kind === 'asmtRow') {
      await db.query(
        `UPDATE db_assessment SET completed_count=$2, assessment_status=$3, submitted_at=$4
           WHERE assessment_id=$1`,
        [m.assessmentId, m.completed_count, m.assessment_status, m.submitted_at]);
    }
  }

  // 序列回退，让下一次灌库不出现空洞。
  await db.query("SELECT setval('db_child_assessment_item_child_assessment_item_id_seq', (SELECT max(child_assessment_item_id) FROM db_child_assessment_item))");
  await db.query("SELECT setval('db_assessment_item_item_id_seq', (SELECT max(item_id) FROM db_assessment_item))");
  await db.query("SELECT setval('db_term_eval_term_eval_id_seq', (SELECT max(term_eval_id) FROM db_term_eval))");
}

async function cleanup() {
  await restoreAll();

  const after = await counts();
  console.log(`\n清理后：${JSON.stringify(after)}`);
  check('逐表行数回到 STATS.md 的基线',
    after.term_eval === BASE.term_eval && after.child_assessment === BASE.child_assessment
    && after.cai === BASE.cai && after.growth_record === BASE.growth_record
    && after.assessment === BASE.assessment && after.assessment_item === BASE.assessment_item,
    JSON.stringify(after));

  // 行数对不代表值对：把动过的 computed 列与语义列各自再核一格。
  const c1 = await db.query(
    'SELECT completed_count, child_assessment_status FROM db_child_assessment WHERE child_id=$1 AND term_id=$2',
    [C1_CHILD, CURRENT_TERM]);
  if (c1.rows[0]) {
    check(`child ${C1_CHILD} 的 completed_count 回到 124 且状态回到 c1`,
      c1.rows[0].completed_count === 124 && c1.rows[0].child_assessment_status === 'c1',
      JSON.stringify(c1.rows[0]));
  }
  const empty = await db.query(
    'SELECT completed_count, child_assessment_status FROM db_child_assessment WHERE child_id=$1 AND term_id=$2',
    [EMPTY_CHILD, CURRENT_TERM]);
  if (empty.rows[0]) {
    check(`child ${EMPTY_CHILD} 的 completed_count 回到 0 且状态回到 c2`,
      empty.rows[0].completed_count === 0 && empty.rows[0].child_assessment_status === 'c2',
      JSON.stringify(empty.rows[0]));
  }
  const asmt = await db.query(
    'SELECT completed_count, assessment_status FROM db_assessment WHERE assessment_id=$1',
    [ASMT_WRITABLE]);
  if (asmt.rows[0]) {
    check(`assessment ${ASMT_WRITABLE} 的 completed_count 回到 109 且状态回到 s2`,
      asmt.rows[0].completed_count === 109 && asmt.rows[0].assessment_status === 's2',
      JSON.stringify(asmt.rows[0]));
  }
  const notes = await scalar('SELECT count(*)::int FROM db_assessment_item WHERE note IS NOT NULL');
  check('db_assessment_item 的 note 回到全为 NULL（基线 0 行）', notes === 0, `实际 ${notes} 行`);
  const te = await db.query(
    'SELECT eval_text, term_eval_status, submitted_at FROM db_term_eval WHERE child_id=$1 AND term_id=$2 AND teacher_id=1',
    [EMPTY_CHILD, CURRENT_TERM]);
  if (te.rows[0]) {
    check(`child ${EMPTY_CHILD} 的学期评价回到空正文 / c2 / 未提交`,
      te.rows[0].eval_text === null && te.rows[0].term_eval_status === 'c2'
      && te.rows[0].submitted_at === null,
      JSON.stringify(te.rows[0]));
  }
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
