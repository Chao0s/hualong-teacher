/**
 * 共建任务的写入面 —— 接受任务与提交材料／反馈（票据 11）。
 *
 * 这是本客户端第一个 UGC 写入服务，后面九个写入页照此执行。它把四件事一次做对：
 *
 *   1. **把关路径在网络出口之前声明。** `assertGate` 在 `api.post` 之前调用，
 *      未声明或声明不全的写入根本不会发出请求（ADR-0016 的阻断级不变量）。
 *   2. **作者字段客户端主动剥离。** 请求体按契约的 `TaskCompletionWrite` 白名单
 *      重建，只留 `feedback`；不依赖服务端的忽略顺序（DO-NOT-BUILD 8，§7.3.1）。
 *   3. **幂等键由调用方按「一次逻辑提交」生成并持有**，重试复用同一个键，
 *      所以重复点击只产生一条提交（§4.2）。
 *   4. **服务层不弹提示、不跳转。** 失败原样抛给页面，由页面交给 reportFailure。
 *
 * ⚠ **材料里的图片在契约上还没有落点。** `POST /tasks/{task_id}/completion` 的
 * 请求体是 `TaskCompletionWrite`，`additionalProperties: false`，只有 `feedback`。
 * 契约自己在 `completeTaskAssignment` 的说明里写着：「提交材料」按钮与「完成」的
 * 分工、以及任务附件（`db_file_ref owner_object='db_task_assign'`）的上传端点
 * **在任何一份权威里都没有定**（notes.md 阻断 2，G40）。所以本服务**不提交图片**，
 * 页面也不建图片入口 —— 造一个把图片传成孤儿 `db_file` 的入口，等于告诉教师照片
 * 交上去了。媒体流本身（§8 的凭证→直传→落库）已在本地契约服务上跑通，等端点定下来
 * 接上即可。
 */

const api = require('../utils/request');
const moderation = require('../utils/moderation');

const PATH = '/tasks';

// api/action-registry.tsv 第 121／122 行的 action_key。带上它，登记册与代码可以对眼。
const ACTION_ACCEPT = 'task_assign.accept';
const ACTION_COMPLETE = 'task_assign.complete';

// 契约 TaskCompletionWrite：additionalProperties: false，maxLength 500。
const FEEDBACK_MAX = 500;

/**
 * 一次逻辑提交的幂等键。
 *
 * 在教师确认发布的那一刻生成一次，之后的每一次重发都复用它。§4.2：键属于一次逻辑
 * 尝试，不属于一次网络重试 —— 每次重发换新键，重复点击就会变成两条提交。
 */
function newAttemptKey() {
  return api.uuid();
}

/**
 * 接受任务（a1 → a2）。
 *
 * **本端点无请求体**（契约明写），因此它不携带任何用户内容，没有可声明的内容类别，
 * 也就不过内容安全闸门 —— 它是一次纯状态转移。`accepted_at` 由服务端设值。
 */
function accept(taskId, { idempotencyKey } = {}) {
  return api.post(`${PATH}/${taskId}/acceptance`, {
    action: ACTION_ACCEPT,
    idempotencyKey,
  });
}

/**
 * 提交材料／反馈（a2 → a3）。
 *
 * @param {object}   o
 * @param {number}   o.taskId
 * @param {string[]} o.gates            把关路径，**必填、无默认值**。页面显式声明。
 * @param {object}   o.draft            教师填的草稿；只有白名单内的字段会被发出
 * @param {boolean}  o.previewedInFull  教师读完了最终内容（不是打开过预览）
 * @param {boolean}  o.confirmed        另一次独立的确认发布动作
 * @param {string}   o.idempotencyKey   一次逻辑提交一个，重发复用
 */
async function complete({ taskId, gates, draft, previewedInFull, confirmed, idempotencyKey }) {
  // 闸门在这里，不在页面里，也不在服务端之后：拒绝必须发生在网络出口之前。
  // `async` 让闸门的拒绝也走 reject —— 调用方只有一条失败路径要照顾，不是同步 throw
  // 与异步 reject 各一条。
  moderation.assertGate(gates, {
    previewedInFull,
    confirmed,
    what: '任务材料',
    // 图片没有落点（见头注），所以这次写入不携带图片。写成常量而不是省略，
    // 是为了让接上端点的那个人改这一行时看得见 assertGate 的另一半。
    imageCount: 0,
  });

  return api.post(`${PATH}/${taskId}/completion`, {
    action: ACTION_COMPLETE,
    idempotencyKey,
    body: buildCompletionBody(draft),
  });
}

/**
 * 按契约的 `TaskCompletionWrite` 重建请求体。
 *
 * 白名单而非黑名单：契约上这个 schema 是 `additionalProperties: false`，所以「只有
 * feedback」是契约形状本身，不是防御性代码。顺带的效果是任何派生作者字段
 * （`teacher_id`／`created_by`／`assign_id`）在客户端就不存在于请求体里，
 * 而不是靠 `utils/derived` 事后剥。两道都在，先后不重要，缺一才重要。
 *
 * 空反馈提交 `null`：`feedback` 的类型是 `[string, 'null']`，教师只点完成不写字
 * 是合法的。
 */
function buildCompletionBody(draft) {
  const text = (draft && typeof draft.feedback === 'string') ? draft.feedback.trim() : '';
  return { feedback: text === '' ? null : text };
}

/** 反馈是否超长。页面用它就地拦，服务端仍会独立复验（§6.4）。 */
function feedbackTooLong(text) {
  return typeof text === 'string' && text.trim().length > FEEDBACK_MAX;
}

module.exports = {
  FEEDBACK_MAX,
  newAttemptKey,
  accept,
  complete,
  buildCompletionBody,
  feedbackTooLong,
};
