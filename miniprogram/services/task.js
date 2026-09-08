/**
 * 待办任务 —— 契约的 `task` 模块（4 条端点）。
 *
 * Boundary: 页面 `require` 本模块、把返回值直接 `setData`，
 * **不在页面里拼 URL、不在页面里译枚举、不在页面里判状态机**。
 *
 *   `GET  /tasks`                       本人的待办清单（游标分页）
 *   `GET  /tasks/{task_id}`             任务详情（含**本人**那一行 assign 与附件）
 *   `POST /tasks/{task_id}/acceptance`  接受（`db_task_assign` a1 → a2）
 *   `POST /tasks/{task_id}/completion`  完成（a2 → a3，可带一段 feedback）
 *
 * **这里说的「任务详情」是 `teacher-task-detail`（待办任务，首页那条线）**，不是
 * `parent-task-detail`（亲子任务，家园社共育那条线）。两页的中文标题逐字相同。
 *
 * ── 两列状态，教师只看自己那一行 ───────────────────────────────────────────
 *
 * F28（解 G62：`db_task.task_status` 是不是 `db_task_assign.assign_status` 的投影）
 * 已定：**两列互不派生**。
 *
 *   `db_task.task_status`          `t1..t4`，一个任务一行，由**管理端**推进
 *   `db_task_assign.assign_status` `a1..a3`，**逐教师一行**，由该教师自己推进
 *
 * 所以**屏幕上的状态取 `assign.assign_status`**，不取 `task_status` —— 否则一位已经
 * 完成的教师会在自己做完的事情上看到「待接收」。`task_status` 在本模块只做一件事：
 * 判两个按钮还能不能点（契约的 `getTask` 逐字：「两列都回，是因为客户端要按
 * `task_status IN ('t1','t2')` 判断两个按钮还能不能点」）。
 *
 * ── 「接受」与「完成」之间没有捷径 ─────────────────────────────────────────
 *
 * `a1 → a2 → a3` 单向，转移图上**没有 a1 → a3 这条边**。所以 `a1` 时只给「接受」，
 * `a2` 时只给「完成」：先给按钮再被服务端 409 拒掉，是界面在说假话。
 * 状态真的在别处变了时（管理端刚取消、同一个人在另一台机器上点过），
 * `actionFailureText()` 把服务端那一格 `details.rule` 译成一句人话。
 *
 * ── 「提交材料」不接线，因为它没有落点（G89） ───────────────────────────────
 *
 * 原型的任务详情有三个按钮：「接受」「完成」「提交材料」。前两个各有端点与列，
 * **第三个三处都空**（G89：教师端「提交材料」按钮没有任何落点）：
 *
 *   一列放文件    `db_task_assign` 只有 `assign_status`／`accepted_at`／
 *                 `completed_at`／`feedback`，**一个文件列都没有**
 *   一条端点      契约的 task 族只有 `getTask`／`acceptTaskAssignment`／
 *                 `completeTaskAssignment`，没有上传或提交材料的操作
 *   一个挂点      `db_file_ref` 的 `owner_object='db_task'` 是**管理端随任务发下来、
 *                 教师只读**的附件（`db/spec/ui-binding.tsv:46` 标 `display`）
 *
 * **所以教师能交上去的东西只有 `db_task_assign.feedback`（`VARCHAR(500)`，「任务反馈」），
 * 它挂在「完成」这一个动作上。** 分工就是这么定的：「完成」带一段可选的文字反馈，
 * 「提交材料」不做。CLAUDE.md §8「没有数据源就不要渲染它，更不要编一个出来」——
 * 在 G89 拍板之前，客户端不得为那个按钮造一个假出口。
 *
 * ── 列表按截止时间升序，这是 G63 教师端那一半的答案 ─────────────────────────
 *
 * G63（三份列表的排序键没有口径 —— 排序键就是游标结构，没有排序键就没有游标，
 * 没有游标就没有列表端点）里逐字列着「教师端任务列表」。**本轮已拍板**：
 * `GET /tasks` 的排序键是 `due_at ASC, task_id ASC` —— 待办清单照「最早要交的先看」
 * 读，所以是升序，与本仓库其余列表的「业务日期 DESC」相反。G63 的另外两份
 * （管理端内容列表、管理端任务列表）**没有解**，那一条仍开着。
 *
 * 列表的每一行只有四样：`task_id`、标题、截止时间、**自己那一行的 `assign_status`**。
 * **列表不回 `task_status`**（F28），所以卡片上没有按钮、也不判两个动作能不能做 ——
 * 那是详情页的事。
 *
 * ── `progress` 不装饰 ──────────────────────────────────────────────────────
 *
 * 契约的 `TaskDetail` 声明了 `progress`（total／accepted／completed／completion_rate），
 * 但服务端不回它（非 required，不算违约）。而且它是**任务级完成度**，与 F28 定死的
 * 「教师看自己那一行」是两件事。回包里没有的值不进 `setData`。
 *
 * ── 详情端点的回包与契约有三处对不上（G90） ────────────────────────────────
 *
 * `GET /tasks/{task_id}` 的实作与它自己的 `TaskDetail` 不一致，三处：
 *
 *   `assign`        契约是**内嵌对象**，实作把那几列**平铺在顶层**
 *   `creator_type`  契约标 **required**，实作的 SELECT 里没有这一列
 *   `teacher_id`    `TaskAssign` 标 **required**，同一条 SELECT 里也没有
 *
 * 本模块两种形状都认（`row.assign || row`），`creator_type` 取不到就不画那一枚
 * 角标。**分歧本身不掩盖**：已登记 `db/GAPS.md` **G90**，服务端补齐之后把这里的
 * 兼容写法一并删掉。`teacher_id` 本模块用不到，所以没有对应的兼容代码。
 */

const api = require('../utils/request');
const time = require('../utils/time');
const media = require('./media');

const TASK_PATH = '/tasks';

/* ── 枚举表。权威是 hualong-backend/db/01_schema.sql 的列注释 ────────────── */

/**
 * `db_task.task_status`（01_schema.sql:1019）。
 *
 * **不进状态徽章**（F28）。它只用来判按钮，以及在按钮消失时说出一句原因 ——
 * 任务被管理端结束或取消之后，一个没有按钮也没有说明的界面读起来像坏掉了。
 */
const TASK_STATUS = { t1: '待接收', t2: '进行中', t3: '已完成', t4: '已取消' };

/** `db_task_assign.assign_status`（01_schema.sql:1044）。**屏幕上显示的是这一列。** */
const ASSIGN_STATUS = { a1: '待接收', a2: '进行中', a3: '已完成' };

/** 三档语气，取值对齐 `teacher-task-detail` 的徽章样式（`.status--wait`／`--doing`／`--done`）。 */
const ASSIGN_TONE = { a1: 'wait', a2: 'doing', a3: 'done' };

/** `db_task.creator_type`（01_schema.sql:1020）。 */
const CREATOR_TYPE = { c1: '教师发起', c2: '管理员发起' };

/** `db_task_assign.feedback` 的字数上限，与 DDL 的 `VARCHAR(500)` 一致。 */
const FEEDBACK_MAX = 500;

/* ── 状态机 ──────────────────────────────────────────────────────────────── */

/**
 * 某个任务状态 + 某个执行状态下，允许哪一个动作。页面据此显示按钮。
 *
 * 写成一张表而不是一串 if：能被探针逐格打一遍。**两层前置逐字对齐服务端那条
 * WHERE**（`routes/teacher-content.mjs` 的两个 `UPDATE ... RETURNING`）：
 *
 *   任务级  `task_status IN ('t1','t2')` —— 管理端结束或取消之后两个动作都停
 *   assign 级  接受要 `a1`，完成要 `a2`
 *
 * 两个动作**同时最多只有一个可点**，因为 `a1 → a3` 这条边不存在。
 */
function allowedActions(taskStatus, assignStatus) {
  if (taskStatus !== 't1' && taskStatus !== 't2') return { accept: false, complete: false };
  return { accept: assignStatus === 'a1', complete: assignStatus === 'a2' };
}

/**
 * 两个按钮都不在时，说明是哪一种「不在」。可点时是空串。
 *
 * 三种原因分开写，因为教师要做的事不一样：任务被取消了就不用管了；任务已结束而
 * 自己没交，要找管理端；自己已经完成了，什么都不用做。
 */
function closedReason(taskStatus, assignStatus) {
  if (taskStatus === 't4') return '这项任务已由管理端取消，不用再处理。';
  if (taskStatus === 't3') return '这项任务已由管理端结束，不能再接受或完成。';
  if (assignStatus === 'a3') return '你已经完成这项任务。';
  return '';
}

/* ── 读 ──────────────────────────────────────────────────────────────────── */

/** `assign_status` 里算「待处理」的两档。`a3` 已完成不算。 */
const PENDING_ASSIGN_STATUS = ['a1', 'a2'];

/**
 * 待办清单的一行。每个值都可以直接 `setData`。
 *
 * 卡片上**没有按钮**，所以这里不算 `allowedActions()` —— 列表端点不回
 * `task_status`（F28），算不出来，也不该在卡片上算。点进详情再判。
 */
function decorateCard(row) {
  const status = row.assign_status;
  return {
    id: row.task_id,
    title: row.task_title || '（未命名）',
    dueAt: row.due_at || '',
    dueLabel: row.due_at ? time.formatStamp(row.due_at) : '',
    status,
    statusLabel: ASSIGN_STATUS[status] || '未知状态',
    tone: ASSIGN_TONE[status] || 'wait',
    pending: PENDING_ASSIGN_STATUS.indexOf(status) >= 0,
  };
}

/**
 * 本人的待办清单，一页。服务端按 `due_at ASC, task_id ASC` 排。
 *
 * 游标为空是结束的唯一信号（§3.1）。这里不筛、不分组：契约没有筛选参数，
 * 而「当前／历史」要按 `task_status` 分，那一列列表端点不回。
 */
async function listTasks({ cursor, limit } = {}) {
  const page = await api.getPage(TASK_PATH, { cursor, limit });
  return { items: page.items.map(decorateCard), nextCursor: page.nextCursor };
}

/**
 * 「待处理」的笔数 —— `assign_status` 在 `a1`／`a2` 的行数。首页那张卡片要它。
 *
 * **靠翻完全部游标数出来，不靠服务端给一个 total。** 契约不回 total
 * （§3.1／DO-NOT-BUILD 11：不存在页号、偏移量、总数），所以要么翻完，
 * 要么这个数就是编的。一名教师名下的任务是有界的量级，翻完是可以接受的代价。
 *
 * 一页取 100（`limit` 上限），把请求数压到最少。
 */
async function countPending() {
  let n = 0;
  let cursor;
  do {
    const page = await api.getPage(TASK_PATH, { cursor, limit: 100 });
    page.items.forEach((row) => {
      if (PENDING_ASSIGN_STATUS.indexOf(row.assign_status) >= 0) n += 1;
    });
    cursor = page.nextCursor;
  } while (cursor);
  return n;
}


/**
 * 一条任务的详情。每个值都可以直接 `setData`。
 *
 * `assign` 是**调用者本人**那一行（`UNIQUE(task_id, teacher_id)`，所以唯一）。
 * 同事的执行状态服务端不回，这里也就没有它的位置。
 */
async function getTask(taskId) {
  const row = await api.get(`${TASK_PATH}/${taskId}`);
  // 契约把本人那一行 assign 声明成**内嵌对象**（`TaskDetail.assign`，
  // `allOf: [TaskAssign]`），而薄契约服务端把那几列**平铺在顶层**回出来
  // （`routes/teacher-content.mjs` 的 `GET /tasks/{task_id}` 一条 SELECT 直接
  // `shape(row)`，`shape()` 不嵌套）。两种都认：按契约先取内嵌那一份，没有再取
  // 平铺的。**这不是防御性代码，是一条今天真的存在的分歧**，已登记 GAPS.md G90；
  // 服务端改成内嵌之后这一行连同 `|| row` 一起删掉。
  const a = row.assign || row;
  const taskStatus = row.task_status;
  const assignStatus = a.assign_status;

  return {
    id: row.task_id,
    title: row.task_title || '（未命名）',
    // 契约的 TaskDetail 必填这三项，缺席即违约，不给兜底字符串。
    intro: row.task_intro,
    division: row.task_division,

    dueAt: row.due_at || '',
    dueLabel: row.due_at ? time.formatStamp(row.due_at) : '',

    // `creator_type` 契约必填，**而服务端今天不回它**（同一条 G90）。取不到就
    // 不画那一枚角标 —— CLAUDE.md §8：没有数据源就不要渲染它，也不要编一个
    // 「未知发起人」出来。
    creatorType: row.creator_type || '',
    creatorLabel: CREATOR_TYPE[row.creator_type] || '',

    // **教师端不显示 task_status**（F28）。它只在下面两格里出场：判按钮、说原因。
    taskStatus,
    can: allowedActions(taskStatus, assignStatus),
    closedReason: closedReason(taskStatus, assignStatus),

    assign: {
      assignId: a.assign_id,
      status: assignStatus,
      statusLabel: ASSIGN_STATUS[assignStatus] || '未知状态',
      tone: ASSIGN_TONE[assignStatus] || 'wait',
      acceptedLabel: a.accepted_at ? time.formatStamp(a.accepted_at) : '',
      completedLabel: a.completed_at ? time.formatStamp(a.completed_at) : '',
      feedback: a.feedback || '',
    },

    files: (row.file_refs || []).map((f) => ({
      fileId: f.file_id,
      name: f.file_name || `附件 ${f.file_id}`,
      usage: f.usage_key || '',
    })),
    // 取档要交上去的宿主那一对（授权参数，不是统计参数）。页面原样传给
    // services/media.js，**不在页面里写表名**。服务端那一支只认自己那一行 assign，
    // 同事的任务附件取不到；`db_task` 不在 `DOWNLOAD_EVENT` 里，取档不记供档事件。
    fileOwner: { object: media.OWNER.TASK, id: row.task_id },
  };
}

/* ── 写 ──────────────────────────────────────────────────────────────────── */

// api/action-registry.tsv 的 action_key。
const ACTIONS = {
  accept: 'task_assign.accept',
  complete: 'task_assign.complete',
};

/**
 * 接受任务（`a1 → a2`），服务端写 `accepted_at`。
 *
 * 请求体为空：`teacher_id` 与 `accepted_at` 都是服务端派生的
 * （§7.3／§1.2，DO-NOT-BUILD 8）。
 */
function accept(taskId) {
  return api.post(`${TASK_PATH}/${taskId}/acceptance`, { action: ACTIONS.accept });
}

/**
 * 完成时的请求体（契约的 `TaskCompletionWrite`，`additionalProperties: false`）。
 *
 * 一个调用点却写成具名函数：`npm run scan:wiring` 的 L3 逐键对契约验请求体，
 * 而它只认**内联字面量**与**本文件里的一个构造函数**。写成三元表达式的话这一格
 * 就静静地不被检查了。
 *
 * `feedback` 可省。省略与空串是两件事：**空串不送**，因为 DDL 上这一列可空，
 * 而「交了一段空白的反馈」没有任何权威定义过。
 */
function completionBody(feedback) {
  const body = {};
  const text = String(feedback || '').trim();
  if (text) body.feedback = text;
  return body;
}

/** 完成任务（`a2 → a3`），服务端写 `completed_at`，同时落这一段 `feedback`。 */
function complete(taskId, feedback) {
  return api.post(`${TASK_PATH}/${taskId}/completion`, {
    action: ACTIONS.complete,
    body: completionBody(feedback),
  });
}

/** 完成前的本地预检。**预检不是校验**：服务端独立再验一次。 */
function whyCannotComplete(feedback) {
  if (String(feedback || '').length > FEEDBACK_MAX) return `任务反馈最多 ${FEEDBACK_MAX} 字`;
  return '';
}

/**
 * 把接受／完成失败译成教师看得懂的一句。
 *
 * 服务端在零行之后分诊，`details` 那一格说得出是哪一种拒绝
 * （`routes/teacher-content.mjs` 的 `refuseTaskAssignAction`），所以这里逐格译：
 *
 *   `requires_t1_or_t2`  任务已 `t3`／`t4`。管理端刚结束或取消了它
 *   `requires_a1`        接受时自己那一行已经不是 `a1` —— 别处已经接过了
 *   `requires_a2`        完成时自己那一行还是 `a1` —— 要先接受
 *   `not_found`          这个任务没派到自己头上（与「任务不存在」逐字节相同，§2.3）
 */
function actionFailureText(err, action) {
  const rule = err && err.details ? String(err.details.rule || '') : '';
  if (rule === 'requires_t1_or_t2') return '这项任务已由管理端结束或取消，不能再操作';
  if (rule === 'requires_a1') return '这项任务已经接受过了，请返回重新打开';
  if (rule === 'requires_a2') return '请先接受这项任务，接受之后才能完成';
  if (err && err.code === 'not_found') return '这项任务不在你名下，请返回列表刷新';
  return (err && err.userMessage) || (action === 'accept' ? '接受失败，请稍后重试' : '完成失败，请稍后重试');
}

module.exports = {
  TASK_STATUS,
  ASSIGN_STATUS,
  CREATOR_TYPE,
  FEEDBACK_MAX,
  allowedActions,
  closedReason,
  listTasks,
  countPending,
  getTask,
  accept,
  complete,
  whyCannotComplete,
  actionFailureText,
};
