/**
 * 评估族 —— 契约的学期评价、综合评估、成长档案、办园质量评估（13 条端点 + 题库 1 条）。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
 *
 *   `GET  /term-evaluations`                                  本班学期评价进度
 *   `GET  /children/{child_id}/term-evaluation`               本人写的那一列（无行回 404）
 *   `PUT  /children/{child_id}/term-evaluation`               提交，NONE→c1，一次写成
 *   `GET  /child-assessments`                                 本班综合评估进度
 *   `GET  /child-assessments/class-report`                    班级综合评估报告
 *   `GET  /children/{child_id}/child-assessment`              某幼儿的主记录 + 已评题
 *   `PUT  /children/{child_id}/child-assessment/items/{id}`   逐题增量评分
 *   `GET  /children/{child_id}/child-assessment/report`       个人综合评估报告
 *   `GET  /growth-records`                                    本班成长档案齐备度
 *   `GET  /assessments`                                       本人的办园质量评估（唯一分页的一条）
 *   `GET  /assessments/{assessment_id}`                       质量评估详情（含逐题）
 *   `PUT  /assessments/{id}/items/{tool_item_code}`           质量评估逐题作答
 *   `GET  /scales/{scale_code}/{scale_version}`               量表题库（reference data）
 *
 * 第 14 条 `GET /children/{child_id}/growth-record`（单条成长档案）**本模块不接** ——
 * `growth-record` 页只要班级整表，没有页面用单条。接了它是「加一个没人调的函数」。
 *
 * ── 未评 = 无行，不是 0 分 ─────────────────────────────────────────────────
 *
 * 契约：`items` 只含已评题，客户端不得把缺席当 0，也不得像原型那样把 radio 预设为
 * 4 分。DDL 同口径：`db_child_assessment_item.score` 是 `SMALLINT NOT NULL`，
 * 没有「未评」这个值 —— 未评是**没有那一行**。
 *
 * 所以本模块一律用 `Map.has` 判存在，**不用 `scores[id] || 0` 兜底、不用
 * `.filter(Boolean)`**：那两种写法把「未评」与「0 分」并成同一件事，而 0 分在契约里
 * 根本不存在（`CHECK score BETWEEN 1 AND 5`）。均值的分子分母只算 `rated` 的题。
 *
 * ── 报告的均分是题项级均值 ─────────────────────────────────────────────────
 *
 * goal / aspect / domain / total 一律取其下**所有题项得分**的均值，**不是下级均值的
 * 再平均**。班级报告同理：取全班已完成幼儿在该领域的全部题项分求均值，不可用各幼儿
 * 领域均分再平均（题项数不等会造成加权失真）。
 *
 * 服务端已经按题项级算了，所以**客户端的义务是不要再算一遍** —— 两边各算一次就有
 * 两个口径，而契约那个才是权威。客户端重算唯一的用处是探针里的交叉验证。
 *
 * ── 草稿不计入班级报告，但要进导出清单 ─────────────────────────────────────
 *
 * 班级报告只统计 `c1`（`x-hualong-scope` 里有 `child_assessment_status='c1'`）。
 * **过滤是服务端的事，客户端不补** —— 补一遍等于把范围判定搬到客户端，那时候
 * 「服务端漏了过滤」就再也没人会发现。
 *
 * 而 `growth-comprehensive-assessment` 的导出浮层**要列草稿**（decision.md §6.2）。
 * 同一页两个口径并存，分别走 `tristate()` 与 `binaryDone()` —— 这就是两个都导出的
 * 原因，混用正是 decision.md 第 14 条要防的事。
 *
 * ── 服务端实作漂移（由 #30 承接，不是本模块的 bug）─────────────────────────
 *
 * 逐条实测于 2026-09-09。本模块**照契约发、照契约读**，只在拿不到的字段上给兜底并
 * 在那一行写明为什么；**一处都不译服务端的字段名** —— 译一次就把契约的形状藏进
 * 客户端，服务端修好那天客户端会静默坏掉。逐条见 `tools/probe-assessment.mjs` 的
 * 头注与 `note()` 登记。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const session = require('../utils/session');
// 只借 `classRoster` 这一个只读派生（本班在园名册）。教师端没有单独的名册端点，
// 而拿 `/child-assessments` 当名册要依赖「每个孩子都有评估行」这个不保证的前提。
const co = require('./co-education');

const TERM_EVAL_PATH = '/term-evaluations';
const CHILD_ASSESSMENT_PATH = '/child-assessments';
const GROWTH_RECORD_PATH = '/growth-records';
const ASSESSMENT_PATH = '/assessments';
const SCALE_PATH = '/scales';
const CHILD_PATH = '/children';

/**
 * `db_term_eval.term_eval_status`、`db_child_assessment.child_assessment_status`
 * 与 `db_growth_record` 的四个状态列共用这一个值域。
 * 权威是 `01_schema.sql` 的列注释。
 */
const COMPLETION_STATUS = { c1: '已完成', c2: '未完成' };

/** `db_assessment.assessment_status`。全部由 `completed_count` 派生，不手工维护。 */
const ASSESSMENT_STATUS = { s1: '未开始', s2: '进行中', s3: '已完成' };

/** `db_assessment.assessment_scope`。`a4=child` 已由 B4 拔除，DDL 的 CHECK 只允许三个值。 */
const ASSESSMENT_SCOPE = { a1: '教师', a2: '班级', a3: '园所' };

/**
 * 五领域码到中文名。`item_id` 的首字符即领域码（层级不落表，靠前缀截断）。
 *
 * 契约的 `ScaleAggregate.code` 只给码，`GET /scales/...` 也不回领域名 ——
 * **这张表是全库唯一一份，不要再在页面里抄。**
 * 权威：`miniprogram/data/guide-scale.js` 的 `domain_id` / `domain_name`；
 * 实测 `db_scale_item` 的 `left(item_id,1)` 分布正是 H36 / L24 / S30 / K23 / A11。
 */
const DOMAIN_NAME = { H: '健康', L: '语言', S: '社会', K: '科学', A: '艺术' };

/**
 * 雷达图与图例的五个角是固定次序：健康 语言 社会 科学 艺术。
 *
 * 必须显式写出来 —— 服务端按 `left(item_id,1)` 的字母序回 `A, H, K, L, S`。
 * **重排放在这里做一次，页面不重排。**
 */
const DOMAIN_ORDER = ['H', 'L', 'S', 'K', 'A'];

// api/action-registry.tsv 的 action_key。四条都是 idempotency=optional，
// 所以 request.js 那张 IDEMPOTENT_ACTIONS 表不用动。
const ACTIONS = {
  submitTermEval: 'term_eval.submit',
  scoreChildItem: 'child_assessment.score_item',
  scoreAssessmentItem: 'assessment.score_item',
};

/** 契约与 DDL 的上限，`db_term_eval.eval_text` 是 `VARCHAR(500)`。 */
const TERM_EVAL_TEXT_MAX = 500;
/** `db_assessment_item.note` 是 `VARCHAR(300)`。 */
const ASSESSMENT_NOTE_MAX = 300;

/* ── 共用件 ─────────────────────────────────────────────────────────────── */

/**
 * 只留当前学期那一行。
 *
 * 三条名册型集合（`/term-evaluations`、`/child-assessments`、`/growth-records`）按
 * 契约「学期由服务端派生」，只该回当前学期。**实测服务端把两个学期都回来了**
 * （2026-09-09：class 1 每条各回 20 行，`2025-2026-1` 与 `2025-2026-2` 各 10 行）。
 * 不筛就是一名幼儿两行，进度表直接翻倍。
 *
 * 筛的依据是会话的 `current_term.term_id`，**不是「最大的那个 term_id」** ——
 * 字母序最大的学期不一定是进行中的那一个。服务端修好之后这个筛是空操作，
 * 所以它不会在那天悄悄变形；契约的 `TermEvaluationProgress` 不带 `term_id`，
 * 不带的行一律留下。
 *
 * **会话没有 `current_term` 时回空数组**（假期内，或服务端的 `currentTerm()` 回 null）。
 * 三张名册表因此整表空白 —— 页面要据此说一句「当前不在学期内」，不要显示成
 * 「一个孩子都没有」。判断用 `session.getCurrentTerm()`，与这里同一个来源。
 */
function currentTermOnly(items) {
  const term = session.getCurrentTerm();
  if (!term) return [];
  return items.filter((row) => !row.term_id || row.term_id === term.term_id);
}

/**
 * 把回包的 `items` 摊成一张查得动的表。
 *
 * 用 Map 而不是 `{}`：`scores[id] || 0` 会把「未评」与「0 分」合成同一件事，
 * 而 0 分在契约里根本不存在（`score` 是 1..5）。要分开就得能问「有没有这一格」。
 */
function itemMap(items) {
  const m = new Map();
  (items || []).forEach((it) => m.set(it.item_id, it.score));
  return m;
}

/** 一题的显示态。`rated` 为假时 `score` 不参与任何计算。 */
function itemCell(scored, itemId) {
  const rated = scored.has(itemId);
  return {
    rated,
    // 页面按 `score === 0` 判「不高亮任何一档」，所以未评给 0；
    // 但 0 只是【给 wxml 的显示值】，任何均值都走 `rated`，不走它。
    score: rated ? Number(scored.get(itemId)) : 0,
  };
}

/**
 * 一组题的均值。**只有 `rated` 的题进分子与分母。**
 * 一题都没评时回 null —— 要表达「尚无评分」而不是 0。
 */
function averageOf(cells) {
  const rated = cells.filter((c) => c.rated);
  if (!rated.length) return null;
  return rated.reduce((sum, c) => sum + c.score, 0) / rated.length;
}

/**
 * 综合评估的三态。**这是全库唯一允许显示草稿的地方**（E4 / decision.md 第 14 条）。
 *
 *   `completed_count === required_count`      → done
 *   `1 .. required_count - 1`                 → draft
 *   `0`（含无主记录）                          → miss
 */
function tristate(row) {
  const done = Number(row && row.completed_count) || 0;
  const need = Number(row && row.required_count) || 0;
  if (need > 0 && done >= need) return 'done';
  if (done > 0) return 'draft';
  return 'miss';
}

/** 任何聚合视图用这一个：**草稿一律折算未完成**（decision.md 第 14 条）。 */
function binaryDone(row) {
  return tristate(row) === 'done';
}

/**
 * 领域聚合，**原样用服务端给的 `average`**，不拿 `items[]` 在客户端重算。
 *
 * 次序按 `DOMAIN_ORDER`，不按服务端的字母序。某领域一题未评时契约要 `average: null`
 * 且 `item_count: 0`，回包里整行缺席也按这一条处理 —— 不得补 0 分。
 */
function decorateDomains(domains) {
  const byCode = new Map((domains || []).map((d) => [d.code, d]));
  return DOMAIN_ORDER.map((code) => {
    const d = byCode.get(code);
    const raw = d ? d.average : null;
    const avg = raw === null || raw === undefined ? null : Number(raw);
    return {
      code,
      label: DOMAIN_NAME[code],
      itemCount: d ? Number(d.item_count) || 0 : 0,
      // 给 utils/radar.js，null 就是未评（它的签名已经接受 null）。
      average: avg,
      averageLabel: avg === null ? '未评' : avg.toFixed(1),
    };
  });
}

/* ══ 成长档案 ══════════════════════════════════════════════════════════════
 *
 *   GET /growth-records                     本班齐备度（只读）
 *
 * 【一个动作都没有。】`db_growth_record` 的四个状态列在 `api/action-coverage.tsv` 里
 * 都是 `no-action`：由齐备判定派生写入，没有任何客户端动作直接改它们。所以本段只有
 * 一个读函数，**没有写函数**。
 *
 * 它**不进家长报告流**（Q60-k），只供教师端进度与管理端统计。
 */

/**
 * 进度表的列。原型是 6 列（家长月度 / 家长学期 / 教师月度 / 教师学期 / 综合 / 成长册），
 * **本模块只给 5 列** —— 第六列「成长册」全库没有数据源：`db_growth_record` 13 列里
 * 没有成长册状态列，`GrowthRecord` schema 12 个属性里也没有。成长册的状态在另一个
 * 模块（`db_growth_book_compilation` 那一族），本段的端点碰不到。
 *
 * CLAUDE.md §8：没有数据源就不要渲染它，更不要编一个出来。
 * **决定 5 列还是 6 列的地方只有这一处。**
 */
const GROWTH_COLUMNS = [
  { key: 'parentMonth', group: '家长', label: '月度' },
  { key: 'parentTerm', group: '家长', label: '学期' },
  { key: 'teacherMonth', group: '教师', label: '月度' },
  { key: 'teacherTerm', group: '教师', label: '学期' },
  { key: 'comprehensive', group: '综合', label: '' },
];

/**
 * 一行的五个格子。计数列比「已完成月数 >= 应完成月数」，编码列比 `c1`。
 *
 * `need === 0` 时计数列判「未完成」而不是「0 之 0 已齐」：学期刚开始一个月都还没到
 * 应完成，那时说「已完成」会让教师以为月度评价不用写了。
 */
function growthStates(row) {
  const need = Number(row.required_month_count) || 0;
  const parentMonths = Number(row.parent_month_complete_count) || 0;
  const teacherMonths = Number(row.teacher_month_complete_count) || 0;
  return [
    need > 0 && parentMonths >= need ? 'done' : 'miss',
    row.parent_term_status === 'c1' ? 'done' : 'miss',
    need > 0 && teacherMonths >= need ? 'done' : 'miss',
    row.teacher_term_status === 'c1' ? 'done' : 'miss',
    row.comprehensive_assessment_status === 'c1' ? 'done' : 'miss',
  ];
}

/**
 * 行 = **本班在园名册**，不是「回包里出现过的幼儿」。
 *
 * 两者不同，差别正是这张表要显示的东西：一名幼儿一整个学期没有档案行，回包里一行
 * 都没有 —— 而他恰恰是最该出现在表上的那一个。先铺名册，再把有记录的格子填进去。
 */
async function rosterBoard(items, keyOf) {
  const byChild = new Map();
  for (const child of await co.classRoster()) {
    byChild.set(child.childId, { childId: child.childId, name: child.name, row: null });
  }
  for (const row of items) {
    if (!byChild.has(row.child_id)) {
      // 名册上没有、却有记录：多半是已转班或离园的幼儿。照实列出来，不吞掉。
      byChild.set(row.child_id, { childId: row.child_id, name: row.child_name || '', row: null });
    }
    byChild.get(row.child_id).row = row;
  }
  return [...byChild.values()].sort((a, b) => a.childId - b.childId).map(keyOf);
}

/** 本班成长档案齐备度表。 */
async function growthRecordBoard() {
  const items = currentTermOnly(await api.getRoster(GROWTH_RECORD_PATH));
  const rows = await rosterBoard(items, (c) => ({
    childId: c.childId,
    name: c.name,
    // 无档案行 = 一格都没齐。造一个空行来判，不特例化。
    states: growthStates(c.row || {}),
    recordStatus: c.row ? c.row.record_status : 'c2',
    recordStatusLabel: COMPLETION_STATUS[c.row ? c.row.record_status : 'c2'] || '未知状态',
    recordDone: Boolean(c.row) && c.row.record_status === 'c1',
    // 【服务端不回 is_term_end】，兜底 false。学期末口径的提示语因此现在一律不显示 ——
    // 那是「假的少显示」，不是「假的多显示」。
    isTermEnd: Boolean(c.row && c.row.is_term_end),
  }));
  const done = rows.filter((r) => r.recordDone).length;
  return {
    columns: GROWTH_COLUMNS,
    rows,
    summary: { total: rows.length, done, undone: rows.length - done },
  };
}

/* ══ 学期评价 ══════════════════════════════════════════════════════════════
 *
 *   GET /term-evaluations                        本班进度
 *   GET /children/{child_id}/term-evaluation     本人那一列（无行回 404）
 *   PUT /children/{child_id}/term-evaluation     提交，NONE→c1，一次写成
 *
 * 【一次写成 c1】：本表值域只有 c1 / c2，而全库没有任何决议为 `db_term_eval` 定义
 * 服务端草稿，所以 c2 目前没有任何写入者（G46）。本段因此**没有保存草稿的函数** ——
 * 不发明一个契约里没有的端点。
 *
 * 【唯一键含 teacher_id】（B9 teacher-keyed，转班后新旧班教师各自一列），所以 GET
 * 单条只回调用者本人那一列。无行回 404，客户端据此进入填写态。
 *
 * 【对外二元】：E4 与 decision.md 第 14 条 —— 学期评价没有对外的草稿态。
 */

/** 本班学期评价进度。行 = 名册（见 `rosterBoard`）。 */
async function termEvaluationBoard() {
  const items = currentTermOnly(await api.getRoster(TERM_EVAL_PATH));
  const rows = await rosterBoard(items, (c) => {
    const status = c.row ? c.row.term_eval_status : 'c2';
    return {
      childId: c.childId,
      name: c.name,
      termEvalId: c.row ? c.row.term_eval_id : null,
      status,
      statusLabel: COMPLETION_STATUS[status] || '未知状态',
      done: status === 'c1',
      submittedLabel: c.row && c.row.submitted_at ? time.formatStamp(c.row.submitted_at) : '—',
    };
  });
  const done = rows.filter((r) => r.done).length;
  return { rows, summary: { total: rows.length, done, undone: rows.length - done } };
}

/** 本人对该幼儿本学期那一列。**无行回 null** —— 调用方据此进填写态，不当错误报。 */
async function getTermEvaluation(childId) {
  let row;
  try {
    row = await api.get(`${CHILD_PATH}/${childId}/term-evaluation`);
  } catch (err) {
    if (err && err.code === 'not_found') return null;
    throw err;
  }
  return {
    childId: Number(row.child_id),
    termEvalId: row.term_eval_id,
    termId: row.term_id || '',
    text: row.eval_text || '',
    textMax: TERM_EVAL_TEXT_MAX,
    // 【服务端不回 file_id】。空数组在这里的意思是「查不到」，不是「没有照片」——
    // 所以照片区本轮不渲染任何一张，入口留着并标明待接入。
    fileIds: Array.isArray(row.file_id) ? row.file_id : [],
    status: row.term_eval_status,
    statusLabel: COMPLETION_STATUS[row.term_eval_status] || '未知状态',
    done: row.term_eval_status === 'c1',
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
  };
}

/**
 * 提交学期评估（NONE→c1）。**一次写成，没有草稿。**
 *
 * 请求体只有 `eval_text` 与 `file_id`。`school_id` / `class_id` / `teacher_id` /
 * `term_id` / `term_eval_status` / `submitted_at` 全不在体里 ——
 * `TermEvaluationWrite` 是 `additionalProperties: false`，多发一个键回 422。
 *
 * 契约回 201 + `Location`；**服务端现在回 200 且改的是已有行**。两个都接受 ——
 * `request.js` 不校验状态码，这里拿到的就是 body。
 */
function submitTermEvaluation(childId, { text, fileIds } = {}) {
  const body = { eval_text: text };
  if (fileIds && fileIds.length) body.file_id = fileIds;
  return api.put(`${CHILD_PATH}/${childId}/term-evaluation`, {
    action: ACTIONS.submitTermEval,
    body,
  });
}

/** 提交前的本地预检。**预检不是校验**：服务端独立再验一次。回空串表示可以。 */
function whyCannotSubmitTermEvaluation({ text } = {}) {
  const t = String(text || '').trim();
  if (!t) return '请先写下这名幼儿的学期评价';
  if (t.length > TERM_EVAL_TEXT_MAX) return `学期评价最多 ${TERM_EVAL_TEXT_MAX} 字`;
  return '';
}

/** 只译本族特有的那几个码，其余交回 `errors.js` 的通用文案。 */
function termEvalFailureText(err) {
  if (err && err.code === 'state_precondition_failed') {
    return '这名幼儿的学期评价已经提交，不能再改了';
  }
  if (err && err.code === 'no_active_term') {
    return '当前不在学期内，学期评价要在学期中填写';
  }
  if (err && err.code === 'not_found') {
    return '这名幼儿不在本班在园名册上，请返回列表刷新';
  }
  return (err && err.userMessage) || '提交失败，请稍后重试';
}

/* ══ 综合评估 ══════════════════════════════════════════════════════════════
 *
 *   GET /child-assessments                                  本班进度
 *   GET /children/{child_id}/child-assessment               主记录 + 已评题
 *   PUT /children/{child_id}/child-assessment/items/{id}    逐题增量评分
 *   GET /children/{child_id}/child-assessment/report        个人报告
 *   GET /child-assessments/class-report                     班级报告
 *   GET /scales/{scale_code}/{scale_version}                量表题库
 *
 * 【一名幼儿一学期一份】：`uk_child_assessment UNIQUE (child_id, term_id)` ——
 * 与 `db_term_eval` 不同，这张表的唯一键**不含** `teacher_id`。
 *
 * 【逐题增量保存】：`PUT .../items/{item_id}` 的请求体只有 `score` 一个字段，
 * `required_count` / `completed_count` / `child_assessment_status` / `submitted_at`
 * 全是服务端算的（`scope-rules.json` 的 `computed.columns` 明列前两个，所有角色不可写）。
 * 中途退出可续填，所以**本模块不做本机草稿** —— 服务端草稿已经解决了这件事，
 * 而且解决得更好（换设备也在）。
 */

/**
 * 124 题题库。**用包内那一份**（`miniprogram/data/guide-scale.js`，本仓库唯一的一份），
 * 不调 `GET /scales/{scale_code}/{scale_version}`。
 *
 * 理由：题文与三档锚点在打分页每一题都要显示，走接口等于每次进页面拉一份 124 题的
 * 大回包；而包内那一份有 `npm test` 第 7 段的闸门守着（逐题比对提问与三档锚点，
 * 改一个字当场红）。`getScale()` 仍然导出 —— 探针用它做**跨源比对**：库里那 124 题
 * 与包内那份逐题比，漂开当场红。
 */
const { flatDomains } = require('../data/guide-scale');

/**
 * `H1-1-1` 那一题的呈现说明。
 *
 * `item_type` 在权威里仍是 `measurement`（忠于《指南》原典），但**后端定为教师照参考表
 * 主观评定**（decision.md 第 13 条 / E2 / G27）：`db_child.birth_date` 与 `gender`
 * 不参与此题计分，系统也不采集身高体重。所以页面上**不显示权威那句「实测换算」的
 * 说明**（`measurement_note`），显示下面这一句。
 *
 * 参考范围表保留 —— 它现在的身份是教师的判断辅助，不是换算依据。
 */
const MEASUREMENT_HINT = '本题由教师照下方参考表主观评定；本系统不采集身高体重。';
const MEASUREMENT_TAG = '参考表辅助';

/** 题库题数。摊平后逐领域相加，不写字面量 124。 */
function scaleItemCount() {
  return flatDomains().reduce((n, d) => n + d.items.length, 0);
}

/** 本班综合评估进度。行 = 名册（见 `rosterBoard`）。三态由这里判，页面不再判。 */
async function childAssessmentProgress() {
  const items = currentTermOnly(await api.getRoster(CHILD_ASSESSMENT_PATH));
  const need = scaleItemCount();
  const rows = await rosterBoard(items, (c) => {
    // 无主记录 = 一题未评。用一个 0 题的空行判，不特例化。
    const row = c.row || { completed_count: 0, required_count: need };
    const state = tristate(row);
    const completedCount = Number(row.completed_count) || 0;
    const requiredCount = Number(row.required_count) || need;
    return {
      childId: c.childId,
      name: c.name,
      childAssessmentId: c.row ? c.row.child_assessment_id : null,
      // 【服务端不回 scale_code / scale_version】，兜底空串。页面上不显示量表编码。
      scaleCode: (c.row && c.row.scale_code) || '',
      scaleVersion: (c.row && c.row.scale_version) || '',
      completedCount,
      requiredCount,
      state,
      stateLabel: { done: '已完成', draft: '草稿', miss: '未完成' }[state],
      sub: state === 'done' ? `五大领域 ${requiredCount} 题已全部完成`
        : state === 'draft' ? `已填写 ${completedCount}/${requiredCount} 题，可继续完成`
          : '尚未开始填写',
      action: state === 'done' ? '查看' : state === 'draft' ? '继续' : '填写',
      status: c.row ? c.row.child_assessment_status : 'c2',
      done: binaryDone(row),
      submittedLabel: c.row && c.row.submitted_at ? time.formatStamp(c.row.submitted_at) : '—',
    };
  });
  const done = rows.filter((r) => r.done).length;
  return { rows, summary: { total: rows.length, done, undone: rows.length - done } };
}

/** 题库 × 已评分 → 填写页的两层结构。领域次序按题库，题库本身就是 H L S K A。 */
function buildDomains(scored) {
  return flatDomains().map((domain) => {
    const items = domain.items.map((q) => {
      const cell = itemCell(scored, q.id);
      return {
        id: q.id,
        name: q.name,
        q: q.q,
        a1: q.a['1'],
        a3: q.a['3'],
        a5: q.a['5'],
        measured: Boolean(q.m),
        tag: q.m ? MEASUREMENT_TAG : '',
        note: q.m ? MEASUREMENT_HINT : '',
        ref: q.ref
          ? q.ref.map((r) => ({
            age: r.age,
            bh: `${r.b[0][0]}~${r.b[0][1]}`,
            bw: `${r.b[1][0]}~${r.b[1][1]}`,
            gh: `${r.g[0][0]}~${r.g[0][1]}`,
            gw: `${r.g[1][0]}~${r.g[1][1]}`,
          }))
          : null,
        rated: cell.rated,
        score: cell.score,
      };
    });
    const avg = averageOf(items);
    const ratedCount = items.filter((i) => i.rated).length;
    return {
      id: domain.id,
      name: domain.name,
      open: false,
      items,
      ratedCount,
      total: items.length,
      scoreText: avg === null
        ? `未评 0/${items.length}`
        : `${ratedCount}/${items.length} · 平均 ${avg.toFixed(1)}`,
    };
  });
}

/**
 * 该幼儿本学期的主记录与已评题，摊成填写页能直接循环的形状。
 *
 * 一题未评时**没有主记录**（主记录在首次评分时建立），此时服务端回 404 —— 那不是
 * 错误，是「还没开始」。这里回一个 `completedCount = 0` 的空壳，页面不必判两种情况。
 *
 * 【服务端不回 child_name】，所以 `childName` 由调用方从上一层（进度表）带过来。
 */
async function getChildAssessment(childId) {
  let row = null;
  try {
    row = await api.get(`${CHILD_PATH}/${childId}/child-assessment`);
  } catch (err) {
    if (!err || err.code !== 'not_found') throw err;
  }
  const need = scaleItemCount();
  const scored = itemMap(row && row.items);
  const domains = buildDomains(scored);
  const all = domains.reduce((acc, d) => acc.concat(d.items), []);
  const avg = averageOf(all);
  const completedCount = row ? Number(row.completed_count) || 0 : 0;
  const requiredCount = row ? Number(row.required_count) || need : need;
  const state = tristate({ completed_count: completedCount, required_count: requiredCount });
  return {
    childId: Number(childId),
    childAssessmentId: row ? row.child_assessment_id : null,
    scaleCode: (row && row.scale_code) || '',
    scaleVersion: (row && row.scale_version) || '',
    completedCount,
    requiredCount,
    status: row ? row.child_assessment_status : 'c2',
    statusLabel: COMPLETION_STATUS[row ? row.child_assessment_status : 'c2'] || '未知状态',
    state,
    domains,
    // 底部那一格。一题未评时给 '—'，不给 0。
    avg: avg === null ? '—' : avg.toFixed(1),
    progressHint: completedCount >= requiredCount && requiredCount > 0
      ? `已评 ${completedCount}/${requiredCount} · 已完成`
      : `已评 ${completedCount}/${requiredCount} · 逐题即时保存`,
    submittedLabel: row && row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
  };
}

/**
 * 逐题增量保存。
 *
 * 【回包不用】。契约说回 `ChildAssessmentProgress`，**服务端回的是题项行**
 * `{ child_assessment_item_id, item_id, score }`。与其两种形状都猜，不如写完重新取
 * 一次进度 —— 多一次往返，换掉一个会在服务端修好那天悄悄变形的分支。
 */
async function scoreItem(childId, itemId, score) {
  await api.put(`${CHILD_PATH}/${childId}/child-assessment/items/${itemId}`, {
    action: ACTIONS.scoreChildItem,
    body: { score: Number(score) },
  });
  return getChildAssessment(childId);
}

/** 逐题评分失败的文案。 */
function scoreFailureText(err) {
  if (err && err.code === 'not_found') {
    return '这份评估打不开了，请返回进度表刷新';
  }
  if (err && err.code === 'validation_failed') {
    return '这一题不在当前量表里，请返回进度表刷新';
  }
  if (err && err.code === 'no_active_term') {
    return '当前不在学期内，综合评估要在学期中填写';
  }
  return (err && err.userMessage) || '这一题没保存上，请再点一次';
}

/**
 * 个人综合评估报告。
 *
 * 领域均分与全卷均分**原样取契约的 `average` 与 `total_average`**：
 *
 *   题项级        4.330645   ← 契约要的（`child_assessment_id=14` 实测）
 *   五领域再平均  4.336181   ← 错的
 *
 * 差 0.0055，四舍五入到一位小数都是 4.3，所以**页面上看不出来** —— 只有探针钉到
 * 小数第四位才抓得到。这就是「断言形状 ≠ 断言值」。
 *
 * 明细 tab 的题名来自包内题库，分数来自契约的 `items[]`（只含已评题）。
 */
async function childAssessmentReport(childId) {
  const row = await api.get(`${CHILD_PATH}/${childId}/child-assessment/report`);
  const legend = decorateDomains(row.domains);
  const scored = itemMap(row.items);
  const total = row.total_average === null || row.total_average === undefined
    ? null : Number(row.total_average);
  const term = session.getCurrentTerm();
  const ratedCount = legend.reduce((n, d) => n + d.itemCount, 0);
  return {
    childId: Number(childId),
    childAssessmentId: row.child_assessment_id,
    termId: row.term_id || '',
    // 学期名取会话的 `current_term.term_name`（实测 `2025-2026学年第二学期`）。
    // **班名没有来源**，原型写死的「中二班」是编的，去掉。
    termName: term ? term.term_name : '',
    scaleCode: row.scale_code || '',
    scaleVersion: row.scale_version || '',
    ratedCount,
    legend,
    // radar.js 的第四个参数：数组里 5 个位置，未评是 null。
    averages: legend.map((d) => d.average),
    totalAverage: total,
    totalAverageLabel: total === null ? '—' : total.toFixed(1),
    detail: flatDomains().map((domain) => {
      const items = domain.items.map((q) => {
        const cell = itemCell(scored, q.id);
        return { id: q.id, name: q.name, rated: cell.rated, score: cell.score };
      });
      const avg = averageOf(items);
      return {
        name: domain.name,
        avgText: avg === null ? '未评' : `平均 ${avg.toFixed(1)}`,
        items,
      };
    }),
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
  };
}

/**
 * 班级综合评估报告。
 *
 * **过滤 c1 是服务端的事，客户端不补** —— 补一遍等于把范围判定搬到客户端，那时候
 * 「服务端漏了过滤」就再也没人会发现。客户端只做一件事：把它当成已经只含 c1 的
 * 数据用，并在探针里钉死这一点。
 *
 * `assessed_child_count` 是**样本量**（已完成 c1 的幼儿数），**不是班级人数**。
 * 页面上的「已完成 2/10」里那个 10 契约没给，取名册长度。
 */
async function classReport() {
  const row = await api.get(`${CHILD_ASSESSMENT_PATH}/class-report`);
  const roster = await co.classRoster();
  // **「字段缺席」与「0 份」要分开。** 服务端今天整个不回这一列（已 note 登记），
  // 折成 0 就会在屏幕上写出「已完成 0/10」——而库里 child 7 与 child 9 确实是 c1，
  // 真值是 2/10。**少显示比显示一个错的数好**（CLAUDE.md §8：没有数据源就不要渲染它）。
  // 所以缺席时 assessed 是 null，比例显示「—/10」，那句话也照实说。
  const assessed = row.assessed_child_count === undefined || row.assessed_child_count === null
    ? null
    : Number(row.assessed_child_count);
  const legend = decorateDomains(row.domains);
  const term = session.getCurrentTerm();
  const need = scaleItemCount();
  return {
    classId: row.class_id,
    termId: row.term_id || '',
    termName: term ? term.term_name : '',
    assessedChildCount: assessed,
    rosterCount: roster.length,
    doneRatio: `${assessed === null ? '—' : assessed}/${roster.length}`,
    // `empty` 只在服务端明确说了「0 份」时为真。缺席不是空 —— 缺席是不知道。
    empty: assessed === 0,
    unknownAssessed: assessed === null,
    legend,
    averages: legend.map((d) => d.average),
    domainCount: DOMAIN_ORDER.length,
    heroNote: assessed === null
      ? `服务端暂未回「已完成份数」，此处只显示班级人数 ${roster.length}。领域均分见下方雷达图。`
      : (assessed
        ? `基于已提交的 ${assessed} 份五大领域李克特量表（每份 ${need} 题）汇总。`
        : '暂无已完成的评估，完成后即可查看班级汇总。'),
  };
}

/**
 * 量表题库（reference data，园所无关，没有 `x-hualong-scope`）。
 *
 * **页面不用它**（题库走包内那一份，见 `flatDomains` 那一段的头注）。
 * 导出它只有一个用途：探针拿它与包内那份**逐题比对**，两份漂开当场红。
 *
 * 【服务端不回 `scale_code` / `scale_version` 外壳】，这里从 path 参数自己带回来 ——
 * 反正是本函数发出去的。
 */
async function getScale(scaleCode, scaleVersion) {
  const row = await api.get(`${SCALE_PATH}/${scaleCode}/${scaleVersion}`);
  return {
    scaleCode: row.scale_code || scaleCode,
    scaleVersion: row.scale_version || scaleVersion,
    items: row.items || [],
  };
}

/* ══ 办园质量评估 ══════════════════════════════════════════════════════════
 *
 *   GET /assessments                                     本人的评估列表（唯一分页的一条）
 *   GET /assessments/{assessment_id}                     详情（含逐题）
 *   PUT /assessments/{id}/items/{tool_item_code}         逐题作答
 *
 * 【本模块不创建评估】。契约明写「本端点不创建评估」：`NONE→s1` 没有任何决议指定谁建、
 * 何时建、`assessment_scope` 与 `assessment_period` 从哪来。教师端唯一的按钮是带着
 * **既有** `assessment_id` 跳转的。
 *
 * 【读写值域不对称是真的，不是笔误】：`AssessmentItem.score` 可 null（题项行存在但
 * 未打分），`AssessmentItemWrite.score` **必须 1—5**。所以「再点一次取消评分」在契约上
 * 没有出路 —— 那个行为已经从页面去掉。
 *
 * 【两个同名一列，含义不同】：`db_assessment_item.item_id` 是整数代理键，
 * `db_child_assessment_item.item_id` 是字符串题号。本段一律用 `toolItemCode`
 * 这个名字，**不出现 `itemId`**。
 */

/**
 * 得分率与等级是**纯客户端派生** —— 契约与 DDL 里没有 `ratio`、没有等级、没有 `levels`。
 * `db_assessment` 只有 `completed_count` / `required_count` / `assessment_status`。
 *
 * 它读的是 `pages/assessment-tool/assessment-data.js`（F17 的版本化代码资产）的
 * `scoring.levels`，算在这里，页面不再算一遍，**也不要把它当服务端的字段**。
 *
 * @param {Array<{score:number|null}>} items 契约的 `AssessmentItem[]`
 * @param {Array<{min:number,label:string}>} levels `scoring.levels`
 */
function scoreRate(items, levels) {
  // 有分的题才进分子与分母。`score === null` 是「题项行存在但未打分」，不是 0 分。
  const scores = (items || []).map((it) => it.score).filter((s) => s !== null && s !== undefined);
  if (!scores.length) return { rated: 0, ratio: null, percent: null, level: '' };
  const ratio = scores.reduce((a, b) => a + b, 0) / (scores.length * 5);
  let label = (levels && levels.length) ? levels[0].label : '';
  (levels || []).forEach((r) => { if (ratio >= r.min) label = r.label; });
  return { rated: scores.length, ratio, percent: Math.round(ratio * 100), level: label };
}

/** 一份评估的卡片。每个值都可以直接 `setData`。 */
function decorateAssessment(row) {
  const status = row.assessment_status;
  const completed = Number(row.completed_count) || 0;
  const required = Number(row.required_count) || 0;
  return {
    id: row.assessment_id,
    scope: row.assessment_scope,
    scopeLabel: ASSESSMENT_SCOPE[row.assessment_scope] || '未知范围',
    // 期间键是**不透明字符串**（`YYYY-MM`），不当日期解析。
    period: row.assessment_period || '',
    toolCode: row.tool_code || '',
    toolVersion: row.tool_version || '',
    completedCount: completed,
    requiredCount: required,
    status,
    statusLabel: ASSESSMENT_STATUS[status] || '未知状态',
    // `s3` 之后契约没有任何转移，进只读态。页面按它显隐打分按钮。
    can: { score: status !== 's3' },
    submittedLabel: row.submitted_at ? time.formatStamp(row.submitted_at) : '—',
  };
}

/**
 * 本人的质量评估列表。**13 条端点里唯一分页的一条**（`Limit` + `Cursor`）。
 *
 * 契约的排序是 `assessment_period DESC, assessment_id DESC`，**客户端不重排**。
 */
async function listAssessments({ cursor, limit } = {}) {
  const page = await api.getPage(ASSESSMENT_PATH, { cursor, limit });
  return { items: page.items.map(decorateAssessment), nextCursor: page.nextCursor };
}

/**
 * 一份评估的详情。逐题分按 `tool_item_code` 索引，页面照 `ind.code` 查。
 *
 * `ind.code`（`I001`）与库里 `db_assessment_item.tool_item_code` **逐字相同**，
 * 不用换算。
 *
 * 【服务端的 items 不回 file_id】，所以佐证材料本轮不接，`evidence` 一律空数组。
 */
async function getAssessment(assessmentId, levels) {
  const row = await api.get(`${ASSESSMENT_PATH}/${assessmentId}`);
  const card = decorateAssessment(row);
  const byCode = new Map();
  (row.items || []).forEach((it) => {
    byCode.set(it.tool_item_code, {
      // `score` 可为 null（行存在、未打分）。这里保持 null，不折成 0。
      score: it.score === null || it.score === undefined ? null : Number(it.score),
      note: it.note === null || it.note === undefined ? '' : it.note,
      fileIds: Array.isArray(it.file_id) ? it.file_id : [],
    });
  });
  return { ...card, items: byCode, summary: scoreRate(row.items, levels) };
}

/**
 * 逐题作答。请求体 `{ score, note?, file_id? }`，`additionalProperties: false`。
 *
 * `note` **照契约发上去** —— 发对了，服务端修好那天不用改客户端。
 * 【服务端的 INSERT 只有三列，`note` 收下就丢】，所以页面那一侧同时把它存在本机，
 * 并在输入框旁标明。探针钉这一项，红着交给 #30。
 */
function scoreAssessmentItem(assessmentId, toolItemCode, { score, note, fileIds } = {}) {
  const body = { score: Number(score) };
  if (note !== undefined && note !== null) body.note = note;
  if (fileIds && fileIds.length) body.file_id = fileIds;
  return api.put(`${ASSESSMENT_PATH}/${assessmentId}/items/${toolItemCode}`, {
    action: ACTIONS.scoreAssessmentItem,
    body,
  });
}

/** 提交前的本地预检。回空串表示可以。 */
function whyCannotScoreAssessmentItem({ score, note } = {}) {
  const n = Number(score);
  if (!(n >= 1 && n <= 5)) return '请先选 1—5 分';
  if (String(note || '').length > ASSESSMENT_NOTE_MAX) {
    return `评价记录最多 ${ASSESSMENT_NOTE_MAX} 字`;
  }
  return '';
}

/** 质量评估打分失败的文案。 */
function assessmentFailureText(err) {
  if (err && err.code === 'not_found') {
    return '这份评估已提交或不在可见范围内，不能再打分';
  }
  if (err && err.code === 'validation_failed') {
    return '分值只能是 1—5 分';
  }
  return (err && err.userMessage) || '这一题没保存上，请再点一次';
}

module.exports = {
  // 枚举与上限
  COMPLETION_STATUS,
  ASSESSMENT_STATUS,
  ASSESSMENT_SCOPE,
  DOMAIN_NAME,
  DOMAIN_ORDER,
  TERM_EVAL_TEXT_MAX,
  ASSESSMENT_NOTE_MAX,

  // 共用件（探针逐格打这几个）
  itemMap,
  itemCell,
  averageOf,
  tristate,
  binaryDone,
  decorateDomains,

  // 成长档案
  GROWTH_COLUMNS,
  growthStates,
  growthRecordBoard,

  // 学期评价
  termEvaluationBoard,
  getTermEvaluation,
  submitTermEvaluation,
  whyCannotSubmitTermEvaluation,
  termEvalFailureText,

  // 综合评估
  MEASUREMENT_HINT,
  MEASUREMENT_TAG,
  scaleItemCount,
  childAssessmentProgress,
  buildDomains,
  getChildAssessment,
  scoreItem,
  scoreFailureText,
  childAssessmentReport,
  classReport,
  getScale,

  // 办园质量评估
  scoreRate,
  listAssessments,
  getAssessment,
  scoreAssessmentItem,
  whyCannotScoreAssessmentItem,
  assessmentFailureText,
};
