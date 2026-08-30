/**
 * 办园质量评估服务 —— 首页那张「质量评估」卡真正指的东西（2026-08-27）。
 *
 * Boundary: `packages/quality` 这个分包，一个分包一个服务模块（票据 12 的规则，
 * `npm run verify:build` 拦下第二个）。
 *
 * ── 它和五大领域量表是两件不同的量具 ────────────────────────────────────────
 *
 *   办园质量评估（本文件）  评的是**园所**：9 个一级指标、30 个小节、120 题。
 *                          表是 `db_assessment` 与 `db_assessment_item`
 *                          （01 home-spec.md）。工具 `school-quality-120@1.0.0`。
 *   五大领域量表           评的是**一名幼儿**：5 个领域、124 题，表是
 *                          `db_child_assessment`，在 services/assessment.js。
 *
 * 两者同构而不同物。首页角标的分母是这 120，不是班上的幼儿数 —— 那个错就是没分清
 * 这两件东西造成的。
 *
 * ── 契约有这三条，别再发明第四条 ────────────────────────────────────────────
 *
 *   `GET /assessments`                              listAssessments
 *   `GET /assessments/{id}`                         getAssessment（Assessment ＋ items）
 *   `PUT /assessments/{id}/items/{tool_item_code}`   scoreAssessmentItem
 *
 * 2026-08-27 这一版的第一稿把它们当成了缺口，另发明了 `/assessment-tools/…`、
 * `/assessments/current` 与一条 `POST …/submission`。**三条都是错的**，而且第三条
 * 错得最深：契约根本没有「提交」这个动作。这条更正留在这里，因为它正是本仓库那条
 * 头等规矩要防的事 —— 契约存在就去读它，不要在它旁边另造一套。
 *
 * ── 四件要紧的 ──────────────────────────────────────────────────────────────
 *
 * 1. **题库随客户端发版，不从端点取。** 契约 `getAssessment` 写着「题文不随作答复制：
 *    客户端按 `tool_code + tool_version` 从版本化代码资产解析题文」。所以它在
 *    `packages/quality/assets/tool.js`（分包内，见第 5 条）。这与五大领域量表**相反**
 *    —— 那一套的题库由 `GET /scales/{code}/{version}` 下发。两件量具两种安排，都是
 *    契约定的。
 *
 * 2. **没有提交动作。** 契约把作答登记成一个动作、两条转移：首题
 *    `assessment.score_item`（s1→s2），末题 `assessment.score_item.complete`（s2→s3）。
 *    评完最后一题那一刻就是完成那一刻，所以页面上没有提交按钮。
 *
 * 3. **没有创建端点。** 契约原话：「本端点不创建评估」，`NONE→s1` 由谁触发是后端
 *    已登记的候选缺口，并注明教师端唯一的按钮是**带着既有 `assessment_id` 跳转的**。
 *    所以本文件不创建，也不在没有编号时替谁挑一份。
 *
 * 4. **评 1 分或 5 分要留佐证。** 工具自带的规则（题库的 `scoring.evidence`），不是
 *    本客户端发明的。佐证走 `db_file_ref(owner_object='db_assessment_item',
 *    usage_key='evidence')` —— `db_assessment_item` 本身没有 `file_id` 列。
 *
 * 5. **题库由调用方传进来，本文件不 require 它。** 题库在 `packages/quality/assets/`，
 *    而本文件在**主包** —— 主包的代码 require 不到分包里的文件（平台规则：分包可以
 *    读主包，反过来不行）。第一版就是这么写的，首页一进来整个应用就报
 *    `module 'packages/quality/assets/tool.js' is not defined`。所以要用题库的那几个
 *    函数都收它作参数，由分包内的页面 require 了再传进来；`open()` 用不着题库，
 *    首页因此只碰得到它。`npm run verify:build` 现在会拦下这类跨包 require。
 *
 * Everything returned is view-ready（实现决定 7）：页面绑定它，自己不查表、不算分。
 */

const api = require('../utils/request');
const guard = require('../utils/guard');

const ASSESSMENT_PATH = '/assessments';

// 题库**不在这里 require**，见头注第五条：它在分包里，而本文件在主包。
// 需要它的函数收它作参数，由分包内的页面传进来。

// db_assessment.assessment_status。**对外二元**够用：这一页只问「评完没有」。
const DONE = 's3';

// 评价记录的上限，抄 spec 的 `note` 列宽。
const NOTE_MAX = 300;

/**
 * 一道题的五个打分档。
 *
 * 档位与文案都来自题库的 `scoring.options`，本文件一个都不写死 —— 工具换版本时
 * 这里不必改。
 */
function scoreOptions(scoring) {
  return (scoring && scoring.options ? scoring.options : []).map((o) => ({
    score: o.score,
    label: o.label,
  }));
}

/**
 * 把 120 条指标按「一级指标 → 小节」两层折起来。
 *
 * 原型 `assessment-tool.html` 就是这么折的：九张可展开的大卡，每张里按小节列题。
 * 一屏 120 题铺开没法用，折叠不是装饰。
 */
function groupIndicators(tool, scores) {
  const byCode = new Map(scores.map((s) => [s.tool_item_code, s]));
  return (tool.sections || []).map((section, index) => {
    const items = (tool.indicators || []).filter((i) => i.section === section.name);
    const done = items.filter((i) => byCode.has(i.code)).length;
    return {
      key: section.name,
      // 原型左侧那个序号方块是一级指标的次序，不是题号。
      index: index + 1,
      name: section.name,
      total: items.length,
      done,
      meta: `${done}/${items.length}`,
      complete: done === items.length,
      items: items.map((i) => {
        const scored = byCode.get(i.code);
        return {
          code: i.code,
          title: i.title,
          sub: i.sub,
          // 三档锚点。原型把它们收在一个可展开的小块里，因为一次读三段字太长。
          anchors: [
            { level: 1, text: i.r1 },
            { level: 3, text: i.r3 },
            { level: 5, text: i.r5 },
          ],
          score: scored ? scored.score : 0,
          note: scored ? scored.note : '',
          scored: Boolean(scored),
          // 工具规则：1 分与 5 分要留佐证。页面据此提示。
          evidence_expected: Boolean(scored && (scored.score === 1 || scored.score === 5)),
        };
      }),
    };
  });
}

/** 总分与等级。等级带来自题库的 `scoring.levels`，本文件不定义分档。 */
function summarise(tool, view) {
  const required = view.required_count || 0;
  const done = view.completed_count || 0;
  const scores = (view.items || []).map((i) => i.score).filter((s) => s >= 1 && s <= 5);
  const sum = scores.reduce((a, b) => a + b, 0);
  // 比值按**已评题**算，不按 120 算：评了 3 题拿 15 分不该显示成 2.5%。
  const ratio = scores.length ? sum / (scores.length * 5) : 0;
  const level = (tool.scoring && tool.scoring.levels ? tool.scoring.levels : [])
    .find((l) => ratio > l.min && ratio <= l.max)
    || { label: scores.length ? '' : '尚未开始' };
  return {
    required,
    done,
    // 进度环与进度条读的是同一个百分数。
    percent: required ? Math.round((done / required) * 100) : 0,
    count_label: `已评 ${done} / ${required} 题`,
    level_label: level.label || '',
    average_label: scores.length ? (sum / scores.length).toFixed(1) : '—',
    complete: view.assessment_status === DONE,
  };
}

/**
 * 打开一份评估。
 *
 * **一个请求**：题库在本地，只有作答要问服务端。
 *
 * `assessmentId` 由调用方给 —— 契约写着「本端点不创建评估」，并注明教师端唯一的按钮
 * 是**带着既有 `assessment_id` 跳转的**。谁建、何时建、`assessment_scope` 与
 * `assessment_period` 从哪来，是后端已登记的候选缺口。所以这里既不创建，也不在没有
 * 编号时替谁挑一份。
 */
async function load(assessmentId, tool) {
  const view = await api.get(`${ASSESSMENT_PATH}/${assessmentId}`);
  const TOOL = tool;
  const TOOL_CODE = tool.tool_code;
  const TOOL_VERSION = tool.tool_version;
  // 旧评估按它自己那一版解释题文（F17）。本客户端只带着现役这一版，版本对不上时
  // 说出来，而不是拿新版题文去解释旧作答 —— 那会让教师读到与当初不同的题。
  const stale = view.tool_code !== TOOL_CODE || view.tool_version !== TOOL_VERSION;
  return {
    assessmentId: view.assessment_id,
    period: view.assessment_period,
    options: scoreOptions(TOOL.scoring),
    evidenceRule: (TOOL.scoring && TOOL.scoring.evidence) || '',
    sections: stale ? [] : groupIndicators(TOOL, view.items || []),
    summary: summarise(TOOL, view),
    readonly: view.assessment_status === DONE,
    staleTool: stale,
    staleReason: stale
      ? `这份评估用的是 ${view.tool_code}@${view.tool_version}，本版应用带的是 ${TOOL_CODE}@${TOOL_VERSION}，题文对不上，先不显示。`
      : '',
  };
}

/**
 * 给一道题作答。拨一次存一次，存在服务端。
 *
 * **契约把它登记成一个动作、两条转移**：首题 `assessment.score_item`（s1→s2），
 * 末题 `assessment.score_item.complete`（s2→s3）。所以**没有提交这个动作** ——
 * 评完最后一题那一刻就是完成那一刻，页面上不该有提交按钮。
 *
 * `completed_count` 与 `assessment_status` 是**派生值**，请求体里没有它们；回包带回
 * 服务端算出的最新进度，页面照它显示，自己不加一。
 *
 * 幂等键：契约给这条 PUT 挂了 `IdempotencyKey` 参数，所以带上。
 */
function scoreItem(assessmentId, code, { score, note, fileIds, idempotencyKey }) {
  return api.put(`${ASSESSMENT_PATH}/${assessmentId}/items/${code}`, {
    idempotencyKey,
    // `AssessmentItemWrite` 是 `additionalProperties: false`，只有这三个键。
    // 佐证材料走 `db_file_ref(owner_object='db_assessment_item', usage_key='evidence')`。
    body: { score, note: note || null, file_id: fileIds || [] },
  });
}

function newScoreKey() {
  return api.uuid();
}

/**
 * 首页那张卡进这里，**带着评估编号**。
 *
 * 契约：「教师端唯一的按钮是带着既有 `assessment_id` 跳转的」。没有编号就没得跳 ——
 * 那说明这位教师这个周期还没有评估，而创建是后端未决的缺口，客户端不替它决定。
 */
const PAGE = '/packages/quality/pages/tool/index';

function open(assessmentId) {
  if (!assessmentId) {
    wx.showToast({ title: '本期还没有质量评估，请联系园所管理员', icon: 'none' });
    return false;
  }
  return guard.navigateTo(`${PAGE}?assessment_id=${assessmentId}`, 'home');
}

module.exports = {
  NOTE_MAX,
  load,
  scoreItem,
  newScoreKey,
  open,
};
