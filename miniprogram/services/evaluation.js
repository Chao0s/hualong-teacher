/**
 * 教师评价服务 —— 月度评价、学期评价与综合评估报告（票据 20）。
 *
 * Boundary: `packages/evaluation` 这个分包，一个分包一个服务模块（票据 12 定的规则，
 * `npm run verify:build` 拦下第二个）。这三页在结构契约上属 `co-education` 模块，但
 * **模块与分包不是一回事** —— 一个 tabBar 模块可以带不止一个分包，`packages/assessment`
 * 借教研培训落门是同一个形状。分开的理由是服务模块边界：在园时光与亲子任务的读写面
 * （`services/co-education`）与评价链没有一行共用。
 *
 * Everything returned is view-ready：页面绑定它，自己不格式化、不查枚举、不算分。
 *
 * ── 本模块最要紧的四条 ───────────────────────────────────────────────────────
 *
 * 1. **月份来自当前日期，教师改不了。** `currentMonth()` 只有一个来源（`utils/time` 的
 *    `currentMonthKey`），页面没有月份选择控件、请求体里的 `eval_month` 也只从这里取。
 *    原型 `teacher-monthly-form.html` 有一个 3—7 月的下拉，那是错的：月度评价填的是
 *    「这个月」，能挑月份就等于能补写或提前写。跨月后再进来看到的自然是新的月份，因为
 *    没有任何一处记住过上一次的月份。
 *
 * 2. **学期评价不重复采集五大领域。** E6／F17 与 `05 home-school-spec.md` 的 content_rule
 *    已经把原型那个「五大领域评价」textarea 删掉了：五大领域由 124 题量表逐题打分、领域
 *    分即时聚合（票据 18），再用文字写一遍是重复劳动，而且两份说法可能互相矛盾（文字写
 *    「语言发展良好」而量表语言领域均分 2.3）。`db_term_eval` 只有 `eval_text` 一个内容列。
 *    所以本模块**读**量表结果（转出 `services/assessment` 的 `radarModel` 与 `childReport`），
 *    一个写入控件也不给它。
 *
 * 3. **`PUT /home-school/month-evals` 被 G51 阻断。** 契约给它写着
 *    `x-hualong-blocked-on: G51`，而且**没有 `x-hualong-action`** —— 未决的是
 *    `month_eval_status` 的 `e1`／`e2` 分界与 `saved_at` 在哪一步落值，不是请求体的形状
 *    （`MonthEvalDraft` 已登记且稳定）。本模块因此这样处置：
 *      - **不做草稿保存，也不做自动保存。** 一个「保存草稿」按钮必须回答「存成 e1 还是
 *        e2」，而那正是未决的那一问。没有这个按钮，就不必替它选一种读法。
 *      - 写入只发生在**教师确认发布的那一刻**：一次逻辑发布，两个请求（PUT 落内容、
 *        POST publication 落 e3），两个幂等键，与 `services/co-education` 的建草稿加发布
 *        同一个形状。
 *      - **不读 `month_eval_status` 的 e1／e2，不读 `saved_at`。** 对外口径是契约给的二元
 *        （E4：`e3` 已完成，其余未完成），那一条不依赖分界。
 *    这样一来，G51 解开时要改的只有一件事：加不加那个按钮。已记进交接。
 *
 * 4. **一个端点两条读法的差别要看清楚。** `GET /term-evaluations` 是名册型进度（整取不
 *    分页，§3.5），`GET /children/{id}/term-evaluation` 是**本人**对该幼儿的那一列
 *    （唯一键含 `teacher_id`，B9），无行回 404 —— 那是「还没填」，不是故障。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const moderation = require('../utils/moderation');
const assessment = require('./assessment');

const MONTH_EVAL_PATH = '/home-school/month-evals';
const TERM_EVAL_LIST_PATH = '/term-evaluations';

// api/action-registry.tsv 的 action_key。带上它，登记册与代码可以对眼。
// `month_eval` 的草稿那一段**登记表上没有行**（G51），所以这里也没有。
const ACTIONS = {
  monthPublish: 'month_eval.publish',
  termSubmit: 'term_eval.submit',
};

/**
 * 内容长度上限，抄契约的 schema。
 *
 * 两处都是 500，而且是**同一个 500**：`TermEvaluationWrite.eval_text` 的说明写着「与
 * `db_month_eval.eval_text` 同上限（F17）」。页面用它做 `maxlength` 与计数，服务端仍独立
 * 复验（§6.4：客户端 UI 从来不是边界）。
 */
const EVAL_TEXT_MAX = 500;

// db_month_eval.month_eval_status。**对外一律二元**（E4）：e3 已完成，其余未完成。
// e1／e2 的分界是 G51 的未决项，所以这张表只把 e3 与「其余」分开，不给 e1 与 e2 各一个说法。
const MONTH_DONE = 'e3';

// CompletionStatus，`db_term_eval.term_eval_status`：c1 已完成／c2 未完成。
const TERM_DONE = 'c1';

// ══════════════════════════════════════════════════════════════════════════
// 当前月份
// ══════════════════════════════════════════════════════════════════════════

/**
 * 这个月的期间键，`YYYY-MM`。**教师端唯一的来源。**
 *
 * 换算规则与理由写在 `utils/time.currentMonthKey` 上方：读的是**时刻**（与时区无关），
 * `+8` 是与 `OFFSET` 同一个字面偏移量，不是一次时区换算。
 *
 * **`Date.now()` 在整个客户端只出现在这一行。** `utils/time` 是纯算术，不读时钟也不读
 * 时区（`tests/parent-task.test.mjs` 守着这一条）；读时钟的动作留在服务层，只有一处，
 * 而且页面可以注入 `nowMs` —— 不可注入就测不了跨月。
 *
 * @param {number} [nowMs] 时刻，缺省取当前时刻。
 */
function currentMonth(nowMs) {
  return time.currentMonthKey(nowMs === undefined ? Date.now() : nowMs);
}

/** `2026-08` -> `2026 年 8 月`。显示用，**不当日期解析**（§1.2）。 */
function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '');
  if (!m) return key || '';
  return `${m[1]} 年 ${Number(m[2])} 月`;
}

// ══════════════════════════════════════════════════════════════════════════
// 月度评价
// ══════════════════════════════════════════════════════════════════════════

/** 一张空的月度评价。`file_id` 给空数组而不是 null：页面按长度开合。 */
function emptyMonthDraft(childId, monthKey) {
  return {
    child_id: childId || 0,
    eval_month: monthKey || currentMonth(),
    eval_text: '',
    file_id: [],
  };
}

/**
 * 按契约的 `MonthEvalDraft` 重建请求体。
 *
 * 白名单而非黑名单：schema 是 `additionalProperties: false` 且只有这四个键。顺带的效果是
 * `teacher_id`／`class_id`／`month_eval_status`／`saved_at`／`created_at`／`updated_at`
 * 在客户端就不存在于请求体里，而不是靠 `utils/derived` 事后剥（DO-NOT-BUILD 8／9）。
 *
 * **`eval_month` 从 `currentMonth()` 取，不从页面的表单状态取。** 页面上没有月份控件，
 * 这里也不留一个能被别处塞值的口子 —— 两道都在，缺一才要紧。
 */
function buildMonthBody(draft, nowMs) {
  const d = draft || {};
  return {
    child_id: Number(d.child_id) || 0,
    eval_month: currentMonth(nowMs),
    eval_text: typeof d.eval_text === 'string' ? d.eval_text.trim() : '',
    file_id: (d.file_id || []).slice(),
  };
}

/**
 * 缺哪些必填项。**返回缺项，不返回真假** —— 与 `services/co-education` 的 `taskBlockers`
 * 同一条理由：页面要就地点名，「有东西没填」帮不了正在找它的教师。
 */
function monthBlockers(draft) {
  const body = buildMonthBody(draft);
  const out = [];
  if (!body.child_id) out.push({ key: 'child_id', text: '先选一名幼儿' });
  if (!body.eval_text) out.push({ key: 'eval_text', text: '评价内容要填' });
  if (body.eval_text.length > EVAL_TEXT_MAX) {
    out.push({ key: 'eval_text', text: `评价内容不超过 ${EVAL_TEXT_MAX} 字` });
  }
  return out;
}

/**
 * 一次逻辑发布的两个幂等键。
 *
 * 在教师确认发布的那一刻生成一次，之后每一次重发都复用它们（§4.2）。落内容与发布是两个
 * 端点、各要一个键，但同属一次逻辑尝试 —— 与 `services/co-education` 的 `newMomentKeys`
 * 同一条理由：每次重发换新键，重复点击就会变成两笔。
 */
function newMonthKeys() {
  return { save: api.uuid(), publish: api.uuid() };
}

/**
 * 把关路径断言。
 *
 * **两类内容的时候要声明两条。** 教师写的字走 `HUMAN_PREVIEW_CONFIRM`（完整预览＋明确
 * 发布），而 `MonthEvalDraft` 有 `file_id` —— 那是从该幼儿相册里**引用**既有照片（E7：
 * 引用复制，不产生新文件）。照片本身在上传那一刻已经走过 `IMAGE_MEDIA_CHECK_ASYNC`，
 * 但**这一次写入仍然携带图片这一类内容**，而 ADR-0016 的表是按内容类别分的，不是按
 * 「这些字节是不是第一次出现」分的。所以带图时两条都声明；`assertGate` 按 `imageCount`
 * 检查覆盖够不够，声明不全等同未声明。
 */
function assertEvalGate(gates, state) {
  moderation.assertGate(gates, {
    what: state.what,
    previewedInFull: state.previewedInFull,
    confirmed: state.confirmed,
    // 图片走先发后审，教师端没有「审核中」中间态（D1／D2），界面上也确实一个字都没提。
    claimsPending: false,
    imageCount: state.imageCount || 0,
  });
}

/**
 * 落内容并发布。**一次逻辑发布，两个请求。**
 *
 * 第一步 `PUT /home-school/month-evals` 按 `child_id + eval_month` upsert（被 G51 阻断的
 * 是它的**状态语义**，不是它的形状 —— 见本文件头注第 3 条）；第二步
 * `POST .../{id}/publication` 落 e3，`e3` 之后永久唯读（契约里没有 e3→e1／e3→e2）。
 *
 * 闸门在**第一步之前**过一次，不是在第二步之前：拒绝必须发生在网络出口之前，而第一步就是
 * 出口。写在这里而不是页面里，理由同 `services/assessment.completeAssessment`。
 *
 * @param {string[]} o.gates            把关路径，**必填、无默认值**。页面显式声明。
 * @param {boolean}  o.previewedInFull  教师读完了最终内容（不是打开过预览）
 * @param {boolean}  o.confirmed        另一次独立的确认发布动作
 * @param {object}   o.keys             `newMonthKeys()` 的返回，重发复用
 */
async function publishMonthEval({ gates, draft, previewedInFull, confirmed, keys, nowMs }) {
  const body = buildMonthBody(draft, nowMs);
  assertEvalGate(gates, {
    what: '月度评价', previewedInFull, confirmed, imageCount: body.file_id.length,
  });

  const saved = await api.put(MONTH_EVAL_PATH, {
    idempotencyKey: keys.save,
    body,
  });
  return api.post(`${MONTH_EVAL_PATH}/${saved.month_eval_id}/publication`, {
    action: ACTIONS.monthPublish,
    idempotencyKey: keys.publish,
  });
}

/**
 * 月度评价的完成情况，**按月份筛一份**。
 *
 * 契约：月份栏由「已存在评价记录的月份」动态生成，**不写死月份清单**，也不假设 2—7 月／
 * 9—1 月（E1／E4）。所以这里不造月份表，只把服务端回的行按幼儿摊平。
 *
 * 二元口径来自契约本身（E4）：`e3` 已完成，`e1｜e2｜无记录` 未完成。**草稿态不对外显示**，
 * 所以这里不给 e1 与 e2 各一个说法 —— 那正是 G51 未决的那一格。
 */
async function listMonthEvals({ eval_month: evalMonth, child_id: childId } = {}) {
  const page = await api.getPage(MONTH_EVAL_PATH, {
    eval_month: evalMonth, child_id: childId,
  });
  return {
    items: page.items.map((row) => ({
      month_eval_id: row.month_eval_id,
      child_id: row.child_id,
      eval_month: row.eval_month,
      month_label: monthLabel(row.eval_month),
      eval_text: row.eval_text || '',
      image_count: (row.file_id || []).length,
      done: row.month_eval_status === MONTH_DONE,
      status_label: row.month_eval_status === MONTH_DONE ? '已完成' : '未完成',
      status_pill: row.month_eval_status === MONTH_DONE ? 'hl-pill--ok' : 'hl-pill--info',
    })),
    nextCursor: page.nextCursor,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 学期评价
// ══════════════════════════════════════════════════════════════════════════

/** 一张空的学期评价。 */
function emptyTermDraft() {
  return { eval_text: '', file_id: [] };
}

/**
 * 按契约的 `TermEvaluationWrite` 重建请求体。**只有内容字段。**
 *
 * `school_id`／`class_id`／`teacher_id` 是上下文，`term_id` 由当前学期派生，
 * `term_eval_status`／`submitted_at` 是服务端派生 —— 契约逐字写着它们都不在这里
 * （§7.3、§1.2）。客户端猜一个学期送过去，是把「绝不猜一个学期」（§5.4）从服务端搬到
 * 客户端。
 */
function buildTermBody(draft) {
  const d = draft || {};
  return {
    eval_text: typeof d.eval_text === 'string' ? d.eval_text.trim() : '',
    file_id: (d.file_id || []).slice(),
  };
}

function termBlockers(draft) {
  const body = buildTermBody(draft);
  const out = [];
  if (!body.eval_text) out.push({ key: 'eval_text', text: '学期综合评语要填' });
  if (body.eval_text.length > EVAL_TEXT_MAX) {
    out.push({ key: 'eval_text', text: `学期综合评语不超过 ${EVAL_TEXT_MAX} 字` });
  }
  return out;
}

/** 一次逻辑提交的幂等键。学期评价**一次写成 c1**，所以只有一个端点、一个键。 */
function newTermKey() {
  return api.uuid();
}

/**
 * 提交学期评价（NONE→c1）。
 *
 * **一次写成 c1**：本表值域只有 c1／c2，而全库没有任何决议为 `db_term_eval` 定义服务端
 * 草稿（契约原话：`c2` 目前没有任何写入者）。所以这里没有草稿这条路 —— 契约不发明草稿
 * 端点，客户端也不发明。
 */
async function submitTermEvaluation({
  gates, childId, draft, previewedInFull, confirmed, idempotencyKey,
}) {
  const body = buildTermBody(draft);
  assertEvalGate(gates, {
    what: '学期评价', previewedInFull, confirmed, imageCount: body.file_id.length,
  });
  return api.put(`/children/${childId}/term-evaluation`, {
    action: ACTIONS.termSubmit,
    idempotencyKey,
    body,
  });
}

/** 本班学期评价进度，名册型，**整取不分页**（§3.5）。 */
async function listTermEvaluations() {
  const items = await api.getRoster(TERM_EVAL_LIST_PATH);
  return items.map((row) => ({
    child_id: row.child_id,
    child_name: row.child_name,
    term_eval_id: row.term_eval_id || null,
    done: row.term_eval_status === TERM_DONE,
    status_label: row.term_eval_status === TERM_DONE ? '已完成' : '未完成',
    status_pill: row.term_eval_status === TERM_DONE ? 'hl-pill--ok' : 'hl-pill--info',
    date_label: row.submitted_at ? time.formatLong(row.submitted_at) : '',
  }));
}

/**
 * 本人对该幼儿本学期的学期评价，**没有就回 null**。
 *
 * 404 不是错误，是「还没填」—— 契约明写无行回 404，客户端据此进入填写态。与
 * `services/assessment.childAssessment` 把首次进入的 404 翻译成空进度是同一件事：
 * 把它当失败弹出来，教师会以为服务坏了。
 */
async function termEvaluation(childId) {
  try {
    const row = await api.get(`/children/${childId}/term-evaluation`);
    return {
      term_eval_id: row.term_eval_id,
      child_id: row.child_id,
      term_id: row.term_id,
      eval_text: row.eval_text || '',
      file_id: (row.file_id || []).slice(),
      done: row.term_eval_status === TERM_DONE,
      date_label: row.submitted_at ? time.formatLong(row.submitted_at) : '',
    };
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * 学期评价能不能写，以及**为什么不能**。
 *
 * 返回一个理由，不返回真假（与 `services/assessment.writeEntry` 同一条理由）：教师要知道
 * 自己为什么不能填。假期是**只读状态，不是错误**（§5.4／§6.4：客户端预先禁用是体贴，
 * 服务端仍独立回 409 no_active_term），所以页面照常打开，写入区换成一行说明，不弹窗。
 */
function termWriteEntry(existing) {
  if (existing && existing.done) {
    return { open: false, reason: '这份学期评价已经提交，内容已锁定，不能再修改。' };
  }
  if (!guard.canWriteThisTerm()) {
    return { open: false, reason: '假期中暂不可填写，新学期开始后恢复。当前没有进行中的学期。' };
  }
  return { open: true, reason: '' };
}

/** 月度评价能不能写。同上，只是已完成的那一支按月份判。 */
function monthWriteEntry(row) {
  if (row && row.done) {
    return { open: false, reason: '这个月的评价已经发布，内容已锁定，不能再修改。' };
  }
  if (!guard.canWriteThisTerm()) {
    return { open: false, reason: '假期中暂不可填写，新学期开始后恢复。当前没有进行中的学期。' };
  }
  return { open: true, reason: '' };
}

// ══════════════════════════════════════════════════════════════════════════
// 综合评估报告
// ══════════════════════════════════════════════════════════════════════════

// db_growth_record 的四个状态列**全部由齐备判定派生写入**，没有任何客户端动作直接改它们
// （`api/action-coverage.tsv` 四行 no-action）。所以本模块只读它，一个写入函数也不给。
const RECORD_DONE = 'c1';

/**
 * 一名幼儿的成长档案齐备度。**这就是「两级评价汇成的一份整体判断」。**
 *
 * 齐备口径由服务端算（§4 规则 4）：非学期末＝截至当月教师月评 e3 与家长月评 p2 齐全；
 * 学期末另需 `db_term_eval` c1、家长学期评价 p2、`db_child_assessment` c1 全部到齐。
 * 客户端**不重算**它 —— 重算一遍就会有第二个可能与服务端不一致的答案。
 */
async function growthRecord(childId) {
  const row = await api.get(`/children/${childId}/growth-record`);
  const required = row.required_month_count || 0;
  const done = row.teacher_month_complete_count || 0;
  return {
    child_id: row.child_id,
    child_name: row.child_name || '',
    term_id: row.term_id,
    is_term_end: Boolean(row.is_term_end),
    month_label: `教师月度评价 ${done} / ${required} 个月`,
    month_done: required > 0 && done >= required,
    term_done: row.teacher_term_status === RECORD_DONE,
    assessment_done: row.comprehensive_assessment_status === RECORD_DONE,
    record_done: row.record_status === RECORD_DONE,
    record_label: row.record_status === RECORD_DONE ? '本学期成长档案已齐备' : '本学期成长档案尚未齐备',
    record_pill: row.record_status === RECORD_DONE ? 'hl-pill--ok' : 'hl-pill--info',
  };
}

/**
 * 报告页要的四份数据，一次读齐。
 *
 * 四个并发请求而不是四个串行：它们互不依赖，串起来只是让教师多等三个往返。
 *
 * **量表那一份直接转用票据 18 的服务**（`assessment.childReport`），本模块不碰一次算术 ——
 * 「页面上没有第二处重复录入同一项的入口」这条验收，在服务层就是「没有第二份算法」。
 * 量表还没开始时它回 404，报告页照样要能开，所以这里把它翻译成 null。
 */
async function report(childId) {
  const [radar, record, months, term] = await Promise.all([
    childRadar(childId),
    growthRecord(childId),
    listMonthEvals({ child_id: childId }),
    termEvaluation(childId),
  ]);
  return { radar, record, months: months.items, term };
}

/**
 * 只要那张图，**没有就回 null**。
 *
 * 学期评价页要的只有这一份（五大领域的结果摆在旁边只读），所以它调这一个而不是 `report`
 * —— 后者会连成长档案与月度评价一起读回来，三趟白跑的往返。
 *
 * 404 是「量表还没开始评」，不是故障：与 `services/assessment.childAssessment` 把首次进入
 * 的 404 翻译成空进度是同一件事。
 */
async function childRadar(childId) {
  try {
    const data = await assessment.childReport(childId);
    return data.radar;
  } catch (err) {
    if (err && err.statusCode === 404) return null;
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 去向
// ══════════════════════════════════════════════════════════════════════════
//
// 路径只在这里说一次，三个页面因此不可能各说各的（services/library.js 的 DESTINATIONS
// 与 services/co-education.js 的 PAGES 同一条判断）。

const MODULE_ID = 'co-education';
const PAGES = {
  month: '/packages/evaluation/pages/month/index',
  term: '/packages/evaluation/pages/term/index',
  report: '/packages/evaluation/pages/report/index',
};

function openMonth(childId) {
  guard.navigateTo(childId ? `${PAGES.month}?child_id=${childId}` : PAGES.month, MODULE_ID);
}

function openTerm(childId) {
  guard.navigateTo(childId ? `${PAGES.term}?child_id=${childId}` : PAGES.term, MODULE_ID);
}

function openReport(childId) {
  guard.navigateTo(`${PAGES.report}?child_id=${childId}`, MODULE_ID);
}

module.exports = {
  EVAL_TEXT_MAX,
  currentMonth,
  monthLabel,
  // 月度评价
  emptyMonthDraft,
  buildMonthBody,
  monthBlockers,
  newMonthKeys,
  publishMonthEval,
  listMonthEvals,
  monthWriteEntry,
  // 学期评价
  emptyTermDraft,
  buildTermBody,
  termBlockers,
  newTermKey,
  submitTermEvaluation,
  listTermEvaluations,
  termEvaluation,
  termWriteEntry,
  // 报告
  growthRecord,
  childRadar,
  report,
  // 票据 18 的量表结果，原样转出。**转出而不是重算**：三个页面因此仍然只 require 一个
  // 服务模块（分包规则），而算法只有一份（services/assessment）。
  radarModel: assessment.radarModel,
  scoreLabel: assessment.scoreLabel,
  // 名册。`GET /child-assessments` 本身就是名册型集合，评价链的三页都靠它列幼儿，
  // 不必再问第二个名册端点。
  listChildren: assessment.listChildAssessments,
  // 去向
  openMonth,
  openTerm,
  openReport,
};
