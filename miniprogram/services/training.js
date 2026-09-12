/**
 * 教研培训 —— 契约的 `training` 模块（6 条端点）。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
 *
 *   `GET  /trainings`                                    研修列表（最新／历史两区）
 *   `GET  /trainings/{id}`                               详情（成功打开写一笔 viewed）
 *   `POST /trainings/{id}/registration`                  报名／恢复报名
 *   `POST /trainings/{id}/registration-cancellation`     取消报名
 *   `GET  /training-participations`                      「我的研修」
 *   `GET  /trainings/{id}/feedback`                      公开回馈流
 *
 * ── 阶段是派生的，不落列 ───────────────────────────────────────────────────
 *
 * `training_phase` 由服务端按**园所时区**算（F9 已删 `training_type`）：
 *
 *   `NOW < start_at`                          → `upcoming`
 *   `start_at <= NOW <= effective_end_at`     → `ongoing`
 *   `NOW > effective_end_at`                  → `history`
 *
 * `effective_end_at` 优先取 `end_at`，为空则取 `start_at` 所在**园所日期**的当日结束。
 *
 * **客户端一个日期都不推。** 页面上的「最新／历史」只是把 `phase` 这个字面量发过去，
 * 不是本地按时间筛 —— 本地推会用设备时区，而园所时区才是权威（DO-NOT-BUILD 9）。
 *
 * ── 报名是一条边覆盖三种入口 ───────────────────────────────────────────────
 *
 * 每名教师每场最多一列，所以「报名」写的始终是同一列：
 *
 *   无列        建列，`participation_status='s1'`
 *   当前 `s2`   复用同列转 `s1`，更新 `registered_at` 并**清空 `cancelled_at`**
 *   当前 `s1`   **幂等**，回 `unchanged`，不产生第二笔副作用
 *
 * 所以登记表里那一行的 `from_state` 是 `ANY` —— 拆成两行会撞上唯一性，
 * 而它们本来就是同一个动作。
 *
 * **`NOW >= start_at` 之后参与状态冻结**，服务端回 409。管理端没有代办入口（F9）。
 *
 * ── 撤回的活动只回壳 ───────────────────────────────────────────────────────
 *
 * `s5` 仍打得开，但**只是壳**：原标题与时间 + 状态，`file_refs`／会议入口／公开回馈
 * 一律不给（F9 撤回后「不提供材料、会议入口或公开回馈」）。**壳不写 viewed 事件** ——
 * 规则 21 的「每次成功开研修详情记 viewed」指的是仍公开的活动，壳不是内容供给。
 *
 * ── 会议链接不内嵌 ─────────────────────────────────────────────────────────
 *
 * `meeting_url` 只供**复制**到浏览器或会议 App（F9）。不做 `web-view`，
 * 也不做「点击直接跳转」—— 那等于内嵌外站。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const media = require('./media');
// 推荐卡的色表与标签走 library 那一份（不另抄）—— 见 library.js 的导出注释。
const library = require('./library');

const TRAINING_PATH = '/trainings';
const PARTICIPATION_PATH = '/training-participations';

/** db_training.training_status。权威是 01_schema.sql 的列注释。 */
const TRAINING_STATUS = { s0: '草稿', s1: '已发布', s5: '已撤回' };

/** 派生阶段，不落列。 */
const TRAINING_PHASE = { upcoming: '未开始', ongoing: '进行中', history: '已结束' };

/** db_training_participation.participation_status。 */
const PARTICIPATION_STATUS = { s1: '已报名', s2: '已取消', s3: '已完成' };

/* ── 状态机 ──────────────────────────────────────────────────────────────── */

/**
 * 某个阶段 + 某个参与状态下，允许哪两个动作。页面据此显示按钮。
 *
 * 写成一张表而不是一串 if：能被探针逐格打一遍。
 *
 * **只有 `upcoming` 能动。** `ongoing` 与 `history` 都已经过了 `start_at`，
 * 参与状态冻结（F9）—— 服务端会回 409，这里先把按钮藏起来。
 *
 * `s3`（已完成）永远不给动：它是有效结束时自动转的终局。
 */
function allowedActions(phase, participation) {
  if (phase !== 'upcoming') return { register: false, cancel: false };
  if (participation === 's1') return { register: false, cancel: true };
  // 无列（undefined／null）与 s2 都可以报名；s2 是恢复报名，走同一条端点。
  if (participation === 's3') return { register: false, cancel: false };
  return { register: true, cancel: false };
}

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/** 列表卡片。每个值都可以直接 `setData`。 */
function decorateCard(row) {
  const phase = row.training_phase;
  const mine = row.my_participation_status || '';
  return {
    id: row.training_id,
    title: row.training_title || '（未命名）',
    excerpt: row.excerpt || '',

    startAt: row.start_at || '',
    // 列表卡片只到日：一场研修哪天开，比它几点开更先被读到。
    startLabel: row.start_at ? time.formatFullDay(row.start_at) : '',
    // 详情页要到分，那里才需要知道几点集合。
    startStamp: row.start_at ? time.formatStamp(row.start_at) : '',
    endAt: row.end_at || '',
    endStamp: row.end_at ? time.formatStamp(row.end_at) : '',
    hasEnd: Boolean(row.end_at),

    location: row.location || '',
    speaker: row.speaker || '',

    status: row.training_status,
    statusLabel: TRAINING_STATUS[row.training_status] || '未知状态',
    // s1 是常态，标一句「已发布」等于在重复「一切正常」；s5 必须标出来。
    statusNote: row.training_status === 's1' ? '' : (TRAINING_STATUS[row.training_status] || ''),
    withdrawn: row.training_status === 's5',

    phase,
    phaseLabel: TRAINING_PHASE[phase] || '未知阶段',
    upcoming: phase === 'upcoming',

    myStatus: mine,
    myStatusLabel: mine ? (PARTICIPATION_STATUS[mine] || '未知状态') : '',
    registered: mine === 's1',
    can: allowedActions(phase, mine),
  };
}

/**
 * 一页研修活动，新的在前。
 *
 * 排序是服务端定的 `start_at DESC, training_id DESC`，客户端不重排。
 * **不搜索、不筛选**（规则 21）—— `phase` 只是「最新／历史」两区的切分，
 * 缺席表示不加这条 predicate。
 */
async function listTrainings({ phase, cursor, limit } = {}) {
  const page = await api.getPage(TRAINING_PATH, { cursor, limit, phase });
  return { items: page.items.map(decorateCard), nextCursor: page.nextCursor };
}

/**
 * 一场研修的详情。**打开这一下会在服务端记一笔 viewed**（规则 21）。
 *
 * `s5` 只回壳：`file_refs`／会议入口／公开回馈都不会有，`withdrawn` 为真时页面
 * 据此说明原因，**不渲染空的材料区**。
 */
async function getTraining(trainingId) {
  const row = await api.get(`${TRAINING_PATH}/${trainingId}`);
  const out = decorateCard(row);
  out.content = row.training_content || '';
  out.effectiveEndAt = row.effective_end_at || '';
  out.meetingTitle = row.meeting_link_title || '';
  out.meetingUrl = row.meeting_url || '';
  // 同空同非空（F9），所以判一个就够；判两个只会在数据违约时显示半截入口。
  out.hasMeeting = Boolean(row.meeting_url);
  out.feedbackCount = Number(row.feedback_count) || 0;
  out.files = (row.file_refs || []).map((f) => ({
    fileId: f.file_id,
    name: f.file_name || `材料 ${f.file_id}`,
    usage: f.usage_key || '',
  }));
  // 取档要交上去的宿主那一对（授权参数，不是统计参数）。页面原样传给
  // services/media.js，**不在页面里写表名**。研修落 k7，服务端每次成功供档记一笔
  // `downloaded`，重复成功重复计数（§4 规则 19／20／21）。
  out.fileOwner = { object: media.OWNER.TRAINING, id: row.training_id };
  return out;
}

/**
 * 公开回馈流。
 *
 * 只有 `feedback_status='s3'` 且活动仍 `s1` 时才有内容 —— **活动撤回后即使回馈列
 * 还在，公开流也回空、计数为 0**（F9）。
 *
 * 审核通过后**真名公开**，姓名由服务端从 `teacher_id` 即时读，不存快照。
 * 「回馈就是评论」—— 没有第二套评论／回覆实体，标签只显示「反馈 N」。
 */
async function listFeedback(trainingId, { cursor, limit } = {}) {
  const page = await api.getPage(`${TRAINING_PATH}/${trainingId}/feedback`, { cursor, limit });
  return {
    items: page.items.map((row) => ({
      id: row.feedback_id,
      teacherId: row.teacher_id,
      name: row.teacher_name,
      initial: String(row.teacher_name || '').slice(0, 1),
      text: row.feedback_text || '',
      publishedLabel: row.published_at ? time.formatStamp(row.published_at) : '',
    })),
    nextCursor: page.nextCursor,
  };
}

/**
 * 「我的研修」—— 只查本人 participation。
 *
 * 它是活动列表的**子集**，不是第二份活动表（规则 21）。`teacher_id` 是 derived，
 * 客户端不发。每一行内嵌一张 `TrainingCard`，所以卡片的装饰复用同一个函数。
 */
async function listMyParticipations({ status, cursor, limit } = {}) {
  const page = await api.getPage(PARTICIPATION_PATH, {
    cursor, limit, participation_status: status,
  });
  return {
    items: page.items.map((row) => {
      const st = row.participation_status;
      return {
        id: row.training_participation_id,
        trainingId: row.training_id,
        status: st,
        statusLabel: PARTICIPATION_STATUS[st] || '未知状态',
        /*
         * 三档各自的语气，取值对齐「我的研修」那一页已有的徽章样式：
         *   s3 已完成 -> done（绿）
         *   s1 已报名 -> doing（蓝，事情还在进行）
         *   s2 已取消 -> plain（灰，不是错误，只是没去）
         * 页面不再判一次。
         */
        tone: st === 's3' ? 'done' : (st === 's1' ? 'doing' : 'plain'),
        registeredLabel: row.registered_at ? time.formatStamp(row.registered_at) : '',
        cancelledLabel: row.cancelled_at ? time.formatStamp(row.cancelled_at) : '',
        completedLabel: row.completed_at ? time.formatStamp(row.completed_at) : '',
        // 契约的 TrainingParticipation 内嵌一张 TrainingCard。
        training: row.training ? decorateCard(row.training) : null,
      };
    }),
    nextCursor: page.nextCursor,
  };
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const ACTIONS = {
  register: 'training_participation.register',
  cancel: 'training_participation.cancel',
};

/**
 * 报名或恢复报名。**一条端点覆盖三种入口状态**，见头注。
 *
 * 已经是 `s1` 时是**幂等的**：回 `unchanged`，不产生第二笔副作用。
 * 所以调用方不必先判「报没报过」—— 那个判断只用来决定按钮显示什么字。
 *
 * 请求体为空，`teacher_id` 是 derived（§7.3，DO-NOT-BUILD 8）。
 */
function register(trainingId) {
  return api.post(`${TRAINING_PATH}/${trainingId}/registration`, { action: ACTIONS.register });
}

/**
 * 取消报名（`s1 → s2`），**只在开始前**。
 *
 * 取消之后开始前还可以再报名，复用同一列。`s2` **不完成** ——
 * 有效结束时只有仍 `s1` 的列自动转 `s3`。
 */
function cancel(trainingId) {
  return api.post(`${TRAINING_PATH}/${trainingId}/registration-cancellation`, {
    action: ACTIONS.cancel,
  });
}

/**
 * 把报名／取消失败译成教师看得懂的一句。
 *
 * 只译这一族**特有**的那个码，其余交回 `errors.js` 的通用文案：
 *
 *   `state_precondition_failed`  多半是活动已经开始了 —— 参与状态在 `start_at`
 *                                之后冻结，而通用文案说不出这一点。
 */
function actionFailureText(err, action) {
  if (err && err.code === 'state_precondition_failed') {
    return '这场研修已经开始，报名状态不能再改了';
  }
  if (err && err.code === 'not_found') {
    return '这场研修不在了，请返回列表刷新';
  }
  return (err && err.userMessage) || (action === 'cancel' ? '取消失败，请稍后重试' : '报名失败，请稍后重试');
}

/**
 * 提交研修回馈（NONE → s2 待审核）。**一人一场一份，提交即冻结。**
 *
 * 只有 `participation_status='s3'`（已完成）且活动已过有效结束时间的人能交 ——
 * 服务端复验，客户端的按钮显隐只是省一次必然被拒的往返。
 *
 * **提交之后查不到自己那一份的状态**：作者不可撤回、不可查询 pending／rejected、
 * 不可查看驳回理由（F9／Q58-ap1）。所以回包是一次性回执，**没有 `feedback_status`**，
 * 也没有对应的 GET —— 审核通过之后才会在公开流里看到自己。
 * 页面据此把提示写成「已提交，审核通过后公开」，**不要显示一个假的「审核中」状态**。
 */
function submitFeedback(trainingId, text) {
  return api.post(`${TRAINING_PATH}/${trainingId}/feedback`, {
    action: 'training_feedback.submit',
    body: { feedback_text: text },
  });
}

/** 回馈的字数上限，与 DDL 的 VARCHAR(1000) 一致。 */
const FEEDBACK_MAX = 1000;

/** 提交前的本地预检。**预检不是校验**：服务端独立再验一次。 */
function whyCannotSubmitFeedback(text) {
  if (!String(text || '').trim()) return '请先写下你的研修反馈';
  if (String(text).length > FEEDBACK_MAX) return `反馈最多 ${FEEDBACK_MAX} 字`;
  return '';
}

/* ── 教研培训首页（G111） ────────────────────────────────────────────────── */

/**
 * 轮播的配色跟着**阶段**走，不是按序号取的。
 *
 * 阶段由服务端按园所时区派生（F9），所以同一条研修在不同日子可能是不同颜色 ——
 * 那是对的：颜色在这里说的是「快开始 / 正在开 / 已结束」。
 */
const PHASE_TONE = { upcoming: 'b1', ongoing: 'b2', history: 'b3' };

/** 轮播是一条横条。正文最长 2000 字，原样塞进去会把版面压垮。 */
const BANNER_DESC_MAX = 60;

/** 轮播卡。原型的 `.banner-img` 绑 tone／kicker／title／desc 四个键。 */
function bannerCard(row) {
  const content = row.training_content || '';
  return {
    tone: PHASE_TONE[row.training_phase] || 'b1',
    kicker: TRAINING_PHASE[row.training_phase] || '',
    title: row.training_title || '',
    desc: content.length > BANNER_DESC_MAX ? `${content.slice(0, BANNER_DESC_MAX)}…` : content,
  };
}

/**
 * 推荐卡。原型的 `.resource-card` 与 `.case-card` 绑的是**同一组六个键**
 * （glyph／tone／name／badge／meta／summary），所以塑形只写一条。
 *
 * `meta` 里原型写的「关联 N 个案例」**这里不拼** —— 那个数要 G109 那个端点
 * （`GET /library/resources/{id}/cases`），首页聚合没有回它。缺的数不编，
 * 少一格好过编一个像真的。
 */
function recommendCard({ name = '', summary = '', tone = 'accent', badge = '', metaParts = [] }) {
  return {
    glyph: name.slice(0, 1),
    tone,
    name,
    badge,
    meta: metaParts.filter(Boolean).join(' · '),
    summary,
  };
}

function resourceRecommendation(row) {
  return recommendCard({
    name: row.resource_name,
    summary: row.resource_explain,
    tone: library.TAG_TONE[row.resource_tag] || 'accent',
    badge: library.RESOURCE_TAG[row.resource_tag] || '',
    metaParts: [library.RESOURCE_TYPE[row.resource_type], library.gradeLabel(row.grade)],
  });
}

function caseRecommendation(row) {
  // `gradeLabel` 吃数组。案例的 `case_grade` 可能已经是数组，也可能是一个值。
  const grades = Array.isArray(row.case_grade) ? row.case_grade : [row.case_grade];
  return recommendCard({
    name: row.case_name,
    summary: row.case_intro,
    tone: library.FIELD_TONE[row.case_field] || 'accent',
    badge: library.CASE_FIELD[row.case_field] || '',
    metaParts: [library.CASE_FIELD[row.case_field], library.gradeLabel(grades)],
  });
}

/**
 * `GET /training/home` —— 教研培训首页的三块内容，一次取回。
 *
 * **不做二次筛选、不做二次排序。** 服务端的「推荐」是按最新派生的
 * （`getPartyHome` 的先例：`db_party_feature` 已由 F7 拔除、不得重建），
 * 客户端再挑一次就变成两套规则，而两套规则一定会漂。
 */
async function getTrainingHome() {
  const row = await api.get('/training/home');
  return {
    banners: (row.carousel || []).map(bannerCard),
    resources: (row.recommended_resources || []).map(resourceRecommendation),
    cases: (row.recommended_cases || []).map(caseRecommendation),
  };
}

module.exports = {
  FEEDBACK_MAX,
  submitFeedback,
  whyCannotSubmitFeedback,
  TRAINING_STATUS,
  TRAINING_PHASE,
  PARTICIPATION_STATUS,
  allowedActions,
  getTrainingHome,
  listTrainings,
  getTraining,
  listFeedback,
  listMyParticipations,
  register,
  cancel,
  actionFailureText,
};
