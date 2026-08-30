/**
 * 五维评价服务 —— 五大领域量表与五维雷达图（票据 18）。
 *
 * Boundary: `packages/assessment` 这个分包，一个分包一个服务模块（票据 12 定的规则，
 * `npm run verify:build` 拦下第二个）。入口页 `pages/training/index` 是 tabBar 页，留在
 * 主包，读的是 services/module-entry.js —— 与资源库借教研培训落一条门是同一个形状。
 *
 * Everything returned is view-ready：页面绑定它，自己不格式化、不查枚举、不算分。
 *
 * ── 本模块最要紧的三条 ───────────────────────────────────────────────────────
 *
 * 1. **题库只有一份，而且不在这里。** 124 题由 `GET /scales/{code}/{version}` 下发
 *    （契约 E2：「题库入库而非前端内嵌」）。本文件一个题目、一句问句、一条锚点也不抄；
 *    `data/guide-scale.json` 是**服务端**的来源，不是客户端的。页面更不持有题目。
 *
 * 2. **未评 = 没有那一列，不是 0 分。** 契约 `ChildAssessmentDetail.items` 的说明逐字
 *    写着「客户端不得把缺席的题当作 0，也不得像原型那样把 radio 预设为 4 分」。所以
 *    `scores` 是一张只含已评题的表，缺席就是缺席。
 *
 * 3. **一个端点两个出口。** `PUT …/items/{item_id}` 在 `api/action-registry.tsv` 上有
 *    两行 —— `child_assessment.score_item`（NONE→c2 存草稿）与
 *    `child_assessment.score_item.complete`（c2→c1 直接提交）。**登记表有两行，端点只有
 *    一个**，不要拆成两条路径。本模块因此给出两个函数、一个路径：`scoreItemDraft` 与
 *    `completeAssessment`。
 *
 * ── 把关路径落在哪一次写入上，以及为什么 ─────────────────────────────────────
 *
 * ADR-0016 的表按**内容类别**分，不按屏幕分。逐题写入的请求体是契约的
 * `ChildAssessmentItemWrite`：`additionalProperties: false`，**只有一个 1—5 的整数**。
 * 题文、锚点、层级全部来自 reference data（`db_scale_item`，无状态列、不进覆盖账本），
 * 不是教师写的字。草稿也不发布任何东西：`child_assessment_status='c2'` 不进班级报告
 * （契约：草稿不计入），不进成长档案齐备判定。
 *
 * 教师的作品在**最后一题落下的那一刻**成为家长可见的报告 —— 那一次写入是发布，走
 * `HUMAN_PREVIEW_CONFIRM`（完整预览＋明确发布）。所以：
 *
 *   scoreItemDraft      不发布，也**拒绝**成为发布：它会算出这一笔是不是最后一题，
 *                       是就抛错，要求调用方改走 completeAssessment。草稿这条路因此
 *                       在结构上到不了「已提交」。
 *   completeAssessment  过闸门，**gates 必填、无默认值**，拒绝发生在网络出口之前。
 *
 * 这就是 `services/co-education.js` 的 `createMomentDraft` 头注里留的那个问题
 * （「契约意义上的自动保存……要另想一个不假装『已经预览过』的形状」）的答案：不假装，
 * 而是让草稿这条路根本走不到发布。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const guard = require('../utils/guard');
const moderation = require('../utils/moderation');

// 现役量表。契约 E2：`db_child_assessment` 在首次评分时绑定这两个值，**升版不回头重判**
// 旧记录。所以这两个常量说的是「新建的评估用哪一版」，读回来的记录用它自己那一版。
const SCALE_CODE = 'guide';
const SCALE_VERSION = '1.0';

// api/action-registry.tsv 的 action_key。带上它，登记册与代码可以对眼。
const ACTIONS = {
  scoreItem: 'child_assessment.score_item',
  scoreItemComplete: 'child_assessment.score_item.complete',
};

/**
 * 五个领域，H/L/S/K/A，顺序即雷达图五个轴的顺序。
 *
 * **契约缺口：领域名不在接口里。** `Scale` 的 schema 只回题项（`item_id`／`item_name`／
 * `question`／`item_type`／`anchors`），四层层级靠 `item_id` 前缀逐级截断得到（§2.6），
 * 而层级的**名字**一个端点也不回。这五个字因此只能在客户端有一份。它们不是题库 ——
 * 题库是 124 条题文，这里是五个领域码的中文名，来自后端 spec 05 的对照
 * （量表用 H/L/S/K/A，`db_assessment_item.assessment_domain` 用 f1..f5，顺序一致）。
 * 已记进交接。
 */
const DOMAINS = Object.freeze([
  Object.freeze({ code: 'H', name: '健康' }),
  Object.freeze({ code: 'L', name: '语言' }),
  Object.freeze({ code: 'S', name: '社会' }),
  Object.freeze({ code: 'K', name: '科学' }),
  Object.freeze({ code: 'A', name: '艺术' }),
]);

// 李克特五级的量程。契约 `ChildAssessmentItemWrite`：`minimum: 1, maximum: 5`。
const SCORE_MIN = 1;
const SCORE_MAX = 5;

// db_child_assessment.child_assessment_status（契约 CompletionStatus：c1 完成／c2 未完成）。
const STATUS_LABEL = { c1: '已完成', c2: '草稿' };

/**
 * 2 分与 4 分的措辞。
 *
 * 量表原文只给 1／3／5 三级行为锚点（分别对应《指南》三个年龄段），2 与 4 是相邻锚点
 * 之间的过渡水平，由教师依据幼儿实际表现判断。这两句话是**五级作答格式**的说明，不是
 * 题目 —— 题目在接口回的 `anchors` 里，本文件一条也不抄。
 *
 * 契约的 `Scale` schema 不回 `response_format`，所以这两句在客户端有一份。同上，缺口
 * 已记进交接。
 */
const BETWEEN_LABEL = {
  2: '介于 1 分与 3 分之间',
  4: '介于 3 分与 5 分之间',
};

// ══════════════════════════════════════════════════════════════════════════
// 取整规则
// ══════════════════════════════════════════════════════════════════════════
//
// **一位小数，四舍五入。图与表用同一个数。**
//
//   roundScore(3.6666…) -> 3.7        roundScore(null) -> null
//
// 三条理由，写在这里而不是散在两个页面里：
//
//   量程    量表是 1—5 的李克特，领域均分的取值范围就是 1—5，跨度 4。一位小数把这 4 分
//           切成 40 档，已经比教师能分辨的差异细一档；两位小数只会把统计噪声读成差别。
//   同源    验收要图与表**同屏对照**。图上画 3.67 而表里写 3.7，教师会去想那 0.03 是
//           什么。所以取整发生在服务层一次，图与表拿到的是同一个数，页面不做第二次计算。
//   空值    未评回 `null`，**不回 0**。接口自己就把「尚无评分」与「均分 0」分开了
//           （`ScaleAggregate.average` 的说明：「该层级一题未评时为 null，接口表达
//           『尚无评分』而不是 0」），客户端不得把这个区分抹掉。
function roundScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value * 10) / 10;
}

/** 显示用的一位小数字符串。`3` -> `3.0`，好让一列数字对得齐。 */
function scoreLabel(value) {
  const rounded = roundScore(value);
  return rounded === null ? '—' : rounded.toFixed(1);
}

// ══════════════════════════════════════════════════════════════════════════
// 量表题库
// ══════════════════════════════════════════════════════════════════════════

/**
 * 题号的四层层级，靠字符串前缀逐级截断得到（契约 §2.6：层级不落表）。
 * `H1-2-3` -> domain `H`、aspect `H1`、goal `H1-2`。
 */
function domainOf(itemId) {
  return String(itemId || '').slice(0, 1);
}

/**
 * 一题的五个选项，**每一项都带上这一题自己的锚点**。
 *
 * 形态定案：**原生滚轮**（form-control-spec.md §1 三问）。第 1 问「是否多选」答否；
 * 第 2 问「≤6 个**且取值固定不随数据变**」答**否** —— 选项文字是这一题的锚点，124 题
 * 各不相同，取值来自服务端下发的题库；第 3 问因此命中，取滚轮。
 *
 * 「按这种形态重新排布」是字面意思：滚轮只显示选中的那一行，所以三条锚点从选择控件里
 * 移出来，放进题卡正文，教师先读锚点再拨滚轮。原型是为下拉列表排的版，信息层级不同。
 */
function scoreOptions(item) {
  const anchors = (item && item.anchors) || {};
  const out = [];
  for (let score = SCORE_MIN; score <= SCORE_MAX; score += 1) {
    const anchor = anchors[String(score)];
    out.push({
      key: String(score),
      label: `${score} 分 · ${anchor || BETWEEN_LABEL[score] || ''}`,
    });
  }
  return out;
}

/**
 * 题库下发，并按领域分组。
 *
 * 分组在服务层，因为页面一次只渲染一个领域 —— 124 题一屏铺开，教师找不到自己填到哪。
 * 分组只读 `item_id` 的前缀，不认识题目内容。
 */
async function scaleDefinition(scaleCode, scaleVersion) {
  const code = scaleCode || SCALE_CODE;
  const version = scaleVersion || SCALE_VERSION;
  const data = await api.get(`/scales/${code}/${version}`);
  const items = (data.items || []).map((item) => ({
    item_id: item.item_id,
    item_name: item.item_name,
    question: item.question,
    // 三条锚点，题卡正文逐条显示。1／3／5 有原文，2／4 是过渡水平。
    anchors: [1, 3, 5].map((level) => ({
      level,
      text: (item.anchors || {})[String(level)] || '',
    })),
    options: scoreOptions(item),
  }));

  const byDomain = {};
  items.forEach((item) => {
    const key = domainOf(item.item_id);
    if (!byDomain[key]) byDomain[key] = [];
    byDomain[key].push(item);
  });

  return {
    scale_code: data.scale_code,
    scale_version: data.scale_version,
    itemCount: items.length,
    // 五个领域恒定五组，即使某个领域一题也没有 —— 少一组会让领域标签的位置随数据跳动。
    domains: DOMAINS.map((d) => ({
      code: d.code,
      name: d.name,
      items: byDomain[d.code] || [],
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 幼儿的评估进度与草稿
// ══════════════════════════════════════════════════════════════════════════

/** 一行进度，`ChildAssessmentProgress` 的 view-ready 形状。 */
function decorateProgress(row) {
  const required = row.required_count || 0;
  const completed = row.completed_count || 0;
  return {
    child_id: row.child_id,
    child_name: row.child_name,
    child_assessment_id: row.child_assessment_id || null,
    scale_code: row.scale_code || null,
    scale_version: row.scale_version || null,
    required_count: required,
    completed_count: completed,
    child_assessment_status: row.child_assessment_status || null,
    // 本页三态由数字自己表达（契约 E4）：等于 required 已完成，1..required-1 草稿，
    // 0（含 child_assessment_id 为空）未开始。§1.1：查表带兜底。
    status_label: completed === 0 ? '未开始'
      : (STATUS_LABEL[row.child_assessment_status] || '草稿'),
    status_pill: completed === 0 ? 'hl-pill--unknown'
      : row.child_assessment_status === 'c1' ? 'hl-pill--ok' : 'hl-pill--info',
    progress_label: `${completed} / ${required} 题`,
    done: row.child_assessment_status === 'c1',
    submitted_at: row.submitted_at || null,
    date_label: row.submitted_at ? time.formatLong(row.submitted_at) : '',
  };
}

/** 本班综合评估进度，名册型，**整取不分页**（§3.5）。 */
async function listChildAssessments() {
  const items = await api.getRoster('/child-assessments');
  return items.map(decorateProgress);
}

/**
 * 一名幼儿本学期的评估，含**已评题**，用来续填。
 *
 * **404 不是错误，是「还没开始」。** 契约明写主记录在首次评分时建立，一题未评时不存在
 * 主记录、此时回 404。教师第一次进量表页看到的就是这个 404 —— 把它当失败弹出来，教师
 * 会以为服务坏了。所以这里把它翻译成一份空进度，其余错误照样抛给页面。
 *
 * @param {object} child `{ child_id, child_name }`，名册给的那一行
 * @param {number} requiredCount 现役量表的题数，用于还没有主记录时的分母
 */
async function childAssessment(child, requiredCount) {
  let data;
  try {
    data = await api.get(`/children/${child.child_id}/child-assessment`);
  } catch (err) {
    if (err && err.statusCode === 404) {
      data = {
        child_id: child.child_id,
        child_name: child.child_name,
        child_assessment_id: null,
        required_count: requiredCount,
        completed_count: 0,
        items: [],
      };
    } else {
      throw err;
    }
  }

  const progress = decorateProgress({ ...data, child_name: data.child_name || child.child_name });
  const scores = {};
  // **只含已评题**。缺席的题不写进这张表，也不写 0 —— 见本文件头注第 2 条。
  (data.items || []).forEach((item) => { scores[item.item_id] = item.score; });
  return { ...progress, scores };
}

/**
 * 这一笔评分会不会把评估从草稿变成已提交？
 *
 * 判据两条，都来自契约：`completed_count` 是**题项列数**，重评一道已评的题不增加列数；
 * 达到 `required_count` 时 `child_assessment_status` 由 c2 派生成 c1。
 *
 * 纯函数，因为它同时是三个地方要问的同一个问题：草稿写入用它拒绝、页面用它决定进不进
 * 预览、测试用它构造那一笔。
 */
function isFinalItem(progress, itemId) {
  if (!progress || !progress.required_count) return false;
  const alreadyScored = progress.scores && progress.scores[itemId] !== undefined;
  if (alreadyScored) return false;
  return progress.completed_count === progress.required_count - 1;
}

/** 还差几题。页面用它显示进度，也用它决定「预览并提交」这个按钮出不出现。 */
function remainingCount(progress) {
  if (!progress) return 0;
  return Math.max(0, (progress.required_count || 0) - (progress.completed_count || 0));
}

/**
 * 逐题存草稿（NONE→c2 或 c2→c2）。
 *
 * **这条路走不到「已提交」。** 最后一题落下的那一刻是发布，必须过 `HUMAN_PREVIEW_CONFIRM`
 * 的完整预览与明确确认；从这里放行会让一次发布绕过闸门。所以它先问 `isFinalItem`，是就
 * 抛错，指名该走哪个函数。这不是防御性代码 —— 教师可以按任意顺序填，最后一题是哪一道
 * 只有到那一刻才知道，判断这件事本身就是本函数的工作。
 *
 * 中间那些不改状态的评分（c2→c2）在登记表上**刻意没有行**：登记表记转移，不记端点。
 */
async function scoreItemDraft({ progress, itemId, score }) {
  if (isFinalItem(progress, itemId)) {
    throw new Error(
      `${itemId} 是最后一题，落下它就是提交。提交要走完整预览与明确确认（ADR-0016），`
      + '不能当草稿写。'
    );
  }
  return api.put(`/children/${progress.child_id}/child-assessment/items/${itemId}`, {
    action: ACTIONS.scoreItem,
    body: buildItemBody(score),
  });
}

/**
 * 按契约的 `ChildAssessmentItemWrite` 重建请求体。
 *
 * 白名单而非黑名单：schema 是 `additionalProperties: false` 且只有 `score`，所以「只有
 * 这一个键」是契约形状本身，不是防御性代码。顺带的效果是 `teacher_id`／`class_id`／
 * `child_assessment_id` 与 `submitted_at`／`created_at` 在客户端就不存在于请求体里，
 * 而不是靠 `utils/derived` 事后剥（DO-NOT-BUILD 8／9，§7.3.1／§1.2）。两道都在，先后
 * 不重要，缺一才重要。
 *
 * `completed_count` 与 `child_assessment_status` 同样不在里面：两者都是服务端由题项列数
 * 派生的，契约原话「请求体里没有它们」。
 */
function buildItemBody(score) {
  return { score: Number(score) };
}

/**
 * 一次逻辑提交的幂等键。教师确认提交的那一刻生成一次，之后每次重发复用它（§4.2）。
 * 每次重发换新键，重复点击就会变成两次写入 —— 而第二次会撞上「已提交，内容已锁定」
 * 的 409，教师看到的是一句莫名其妙的拒绝，而不是一份提交成功的量表。
 */
function newAttemptKey() {
  return api.uuid();
}

/**
 * 提交（c2→c1）。**最后一题的那一次写入就是发布。**
 *
 * @param {object}   o
 * @param {object}   o.progress         当前进度，`childAssessment` 的返回
 * @param {string}   o.itemId           最后一题的题号
 * @param {number}   o.score            那一题的分
 * @param {string[]} o.gates            把关路径，**必填、无默认值**。页面显式声明。
 * @param {boolean}  o.previewedInFull  教师读完了最终内容（不是打开过预览）
 * @param {boolean}  o.confirmed        另一次独立的确认发布动作
 * @param {string}   o.idempotencyKey   一次逻辑提交一个，重发复用（§4.2）
 */
async function completeAssessment({
  progress, itemId, score, gates, previewedInFull, confirmed, idempotencyKey,
}) {
  // 闸门在这里，不在页面里，也不在服务端之后：拒绝必须发生在网络出口之前。
  moderation.assertGate(gates, {
    previewedInFull,
    confirmed,
    what: '五大领域量表',
    // 本次写入不携带图片：`ChildAssessmentItemWrite` 里没有 `file_id`，佐证材料是
    // 办园质量评估那一套工具的事，不是本票的。写成常量而不是省略，是为了让将来想加
    // 图片的那个人改这一行时看得见 assertGate 的另一半。
    imageCount: 0,
  });

  return api.put(`/children/${progress.child_id}/child-assessment/items/${itemId}`, {
    action: ACTIONS.scoreItemComplete,
    idempotencyKey,
    body: buildItemBody(score),
  });
}

/**
 * 量表能不能写，以及为什么不能。
 *
 * **返回一个理由，不返回真假**（与 services/training.js 的 `feedbackEntry` 同一条理由）：
 * 教师要知道自己为什么不能填，而不只是不能。渲染成一行说明，不做成一个会当面拒绝他的
 * 按钮。假期是**只读状态，不是错误**（§5.4 / §6.4：客户端预先禁用是体贴，服务端仍独立
 * 回 409 no_active_term）。
 */
function writeEntry(progress) {
  if (progress && progress.done) {
    return { open: false, reason: '这份量表已经提交，内容已锁定，不能再修改。' };
  }
  if (!guard.canWriteThisTerm()) {
    return { open: false, reason: '假期中暂不可填写，新学期开始后恢复。当前没有进行中的学期。' };
  }
  return { open: true, reason: '' };
}

// ══════════════════════════════════════════════════════════════════════════
// 报告与五维雷达图
// ══════════════════════════════════════════════════════════════════════════

/**
 * 一份报告的雷达图模型。**图与表的唯一数据来源，页面不做第二次计算。**
 *
 * 五个轴恒定五个，顺序恒定 H/L/S/K/A，与量表的五个领域一一对应 —— 报告里少回一个领域
 * 时那个轴的值是 `null`，而不是消失。轴消失会让五边形变成四边形，教师看到的是一张形状
 * 不同的图，而事实只是那个领域还没评。
 *
 * `value` 与 `value_label` 是**同一个数**的两种写法（见 roundScore 的取整规则）：图画
 * `value`，表写 `value_label`，两者不会对不上。
 */
function radarModel(report) {
  const byCode = {};
  ((report && report.domains) || []).forEach((d) => { byCode[d.code] = d; });

  const axes = DOMAINS.map((d) => {
    const hit = byCode[d.code];
    const value = hit ? roundScore(hit.average) : null;
    return {
      code: d.code,
      name: d.name,
      value,
      value_label: value === null ? '—' : value.toFixed(1),
      item_count: hit ? (hit.item_count || 0) : 0,
    };
  });

  const scored = axes.filter((a) => a.value !== null);
  const missing = axes.filter((a) => a.value === null);

  return {
    axes,
    max: SCORE_MAX,
    min: 0,
    // 画不画，只看这一条。**五个轴全部有值才画**：缺一个轴的多边形合不拢，硬画出来的
    // 那条边是编的。缺得多是空状态，不是一个塌成一点的五边形（票据验收项 8）。
    can_draw: scored.length === DOMAINS.length,
    // 说明性的空状态：说出还差哪几个领域，而不是一句「暂无数据」。
    empty_reason: scored.length === 0
      ? '这份评估还没有任何得分，填完量表后这里才有图可画。'
      : missing.length
        ? `还差 ${missing.map((a) => a.name).join('、')} ${missing.length} 个领域没有评分，`
          + '五个轴齐了才画得出五维雷达图。'
        : '',
    total_label: report ? scoreLabel(report.total_average) : '—',
    scale_label: report && report.scale_code
      ? `${report.scale_code} ${report.scale_version}` : '',
    date_label: report && report.submitted_at ? time.formatLong(report.submitted_at) : '',
  };
}

/** 一名幼儿的个人报告。契约：零文字分析，只有五领域均分与逐题明细。 */
async function childReport(childId) {
  const report = await api.get(`/children/${childId}/child-assessment/report`);
  return {
    child_assessment_id: report.child_assessment_id,
    child_id: report.child_id,
    term_id: report.term_id,
    radar: radarModel(report),
  };
}

/**
 * 班级报告。**只统计已完成评估**，草稿不计入。
 *
 * `assessed_child_count` 为 0 且 `domains` 为空是契约刻意给的信号：前端据此区分「均分 0」
 * 与「尚无资料」。这里把它翻译成空状态的那句话，不翻译成一张全零的图。
 */
async function classReport() {
  const report = await api.get('/child-assessments/class-report');
  const count = report.assessed_child_count || 0;
  const radar = radarModel(report);
  return {
    class_id: report.class_id,
    term_id: report.term_id,
    assessed_child_count: count,
    sample_label: `样本量：本班 ${count} 名幼儿已完成评估`,
    radar: count === 0
      ? {
        ...radar,
        can_draw: false,
        empty_reason: '本班还没有任何一份已提交的量表。草稿不计入班级报告，'
          + '所以这里暂时没有图可画。',
      }
      : radar,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 去向
// ══════════════════════════════════════════════════════════════════════════
//
// 路径只在这里说一次，三个页面因此不可能各说各的（services/library.js 的 DESTINATIONS
// 与 services/co-education.js 的 PAGES 同一条判断）。

const MODULE_ID = 'teaching-research';
const PAGES = {
  fiveChart: '/packages/assessment/pages/five-chart/index',
  scale: '/packages/assessment/pages/scale/index',
  radar: '/packages/assessment/pages/radar/index',
};

function openFiveChart() {
  guard.navigateTo(PAGES.fiveChart, MODULE_ID);
}

function openScale(childId) {
  const url = childId ? `${PAGES.scale}?child_id=${childId}` : PAGES.scale;
  guard.navigateTo(url, MODULE_ID);
}

/** 个人雷达图带幼儿编号，班级雷达图带 `scope=class`。两者同一个页面。 */
function openRadar(childId) {
  const url = childId ? `${PAGES.radar}?child_id=${childId}` : `${PAGES.radar}?scope=class`;
  guard.navigateTo(url, MODULE_ID);
}

module.exports = {
  // 取整规则的两个出口，页面与测试都对着它们问「这个数该怎么写」。其余常量
  // （量表编码与版本、量程、五个领域、状态码表）只在本模块内部用，不外露。
  roundScore,
  scoreLabel,
  scaleDefinition,
  listChildAssessments,
  childAssessment,
  isFinalItem,
  remainingCount,
  buildItemBody,
  newAttemptKey,
  scoreItemDraft,
  completeAssessment,
  writeEntry,
  radarModel,
  childReport,
  classReport,
  openFiveChart,
  openScale,
  openRadar,
};
