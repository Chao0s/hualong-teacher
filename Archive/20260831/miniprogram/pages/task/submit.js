/**
 * 任务材料／反馈提交页 — 本客户端第一个 UGC 写入页（票据 11）。
 *
 * 三个阶段，顺序不可跳：
 *
 *   edit     教师写反馈。此时没有任何东西发得出去。
 *   preview  教师读**最终内容**。读到底才算完整预览 —— 这是把关本身，不是提示。
 *   done     已提交，内容锁定，不能再改。
 *
 * 完整预览与明确发布是**两个独立条件**：读到底只解锁「确认提交」这个按钮，按下它
 * 才是第二个动作。两者缺一，`utils/moderation` 在请求发出之前就拒绝。
 *
 * 预览的内容与提交的内容是**同一个对象**：`onPreviewTap` 把草稿冻结成
 * `preview.draft`，`onConfirmTap` 发的就是它，不是页面上的实时草稿。教师在预览之后
 * 改了字，预览随之作废，必须重看一遍。
 *
 * 假期与已结束的任务返回的是**只读状态，不是错误**：页面照常打开，写入区换成一行
 * 理由。教师不该点进一个会当面拒绝他的按钮。
 *
 * 没有视频入口，一个也没有（DO-NOT-BUILD 12）。也没有图片入口 —— 任务附件的上传
 * 端点在契约里还不存在，理由写在 services/task-submit.js 的头注里。
 */

const guard = require('../../utils/guard');
const identity = require('../../services/identity');
const task = require('../../services/task');
const taskSubmit = require('../../services/task-submit');
const moderation = require('../../utils/moderation');
const { reportFailure } = require('../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 只有文字一条：本页不携带图片（见 services/task-submit.js 头注）。接上任务附件的
 * 端点时，这里加 `moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC`，并把
 * `task-submit.complete` 里的 `imageCount` 接上真实张数 —— 两处一起改，漏一处
 * `assertGate` 会拦下来。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,
    taskId: 0,
    task: null,

    // 只读态：假期，或任务已结束／已取消。是状态，不是错误。
    readonly: false,
    readonlyReason: '',
    // 还没接受任务时，提交路径要先经过接受。
    needsAccept: false,
    accepting: false,

    stage: 'edit',
    feedback: '',
    feedbackTooLong: false,
    previewedInFull: false,
    confirmed: false,
    locked: false,
    preview: null,
    submitting: false,
    // 一次逻辑提交的幂等键，生成一次、重发复用（§4.2）。
    attemptKey: '',

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const taskId = Number(query.task_id);
    if (!taskId) {
      this.setData({ ready: true, loading: false, errorText: '缺少任务编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, taskId });
    this.load(taskId);
  },

  onRetryLoad() {
    if (!this.data.taskId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.taskId);
  },

  async load(taskId) {
    try {
      const row = await task.detail(taskId);
      // 学期状态是一等公民（票据 06）：本页读 termState 决定的东西，从不自己看学期枚举。
      const entry = task.submitEntry({
        taskStatus: row.task_status,
        canWrite: identity.termState().canWrite,
      });
      this.setData({
        task: row,
        readonly: entry.disabled,
        readonlyReason: entry.reason,
        needsAccept: row.assign_status === 'a1',
        loading: false,
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /**
   * 草稿变了，预览就作废。
   *
   * 「预览内容与最终提交内容一致」只有这样才成立：改完字不重看一遍，上一次的
   * 完整预览就不再是对这份内容的把关。
   */
  onFeedbackInput(e) {
    if (this.data.locked) return;
    const feedback = e.detail.value;
    this.setData({
      feedback,
      feedbackTooLong: taskSubmit.feedbackTooLong(feedback),
      previewedInFull: false,
      confirmed: false,
      preview: null,
    });
  },

  /** 进入预览。把草稿**冻结**成最终内容，之后提交的就是这一份。 */
  onPreviewTap() {
    if (this.data.readonly || this.data.locked) return;
    if (this.data.feedbackTooLong) return;
    const draft = { feedback: this.data.feedback };
    this.setData({
      stage: 'preview',
      previewedInFull: false,
      confirmed: false,
      preview: {
        draft,
        // 教师在预览里看到的字，与将要发出的请求体，来自同一次构造。
        body: taskSubmit.buildCompletionBody(draft),
      },
    });
  },

  /**
   * 预览滚到底。这是「完整预览」的落点 —— 打开预览不算，读到最后一行才算。
   * 内容短到不需要滚动时，`bindscrolltolower` 在渲染后立即触发，语义一致。
   */
  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', previewedInFull: false, confirmed: false, preview: null });
  },

  /** 接受任务（a1 → a2）。无请求体，不携带内容，因此不过内容安全闸门。 */
  async onAcceptTap() {
    if (this.data.accepting || this.data.readonly) return;
    this.setData({ accepting: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      await taskSubmit.accept(this.data.taskId, {
        idempotencyKey: taskSubmit.newAttemptKey(),
      });
      this.setData({ accepting: false, needsAccept: false });
      await this.load(this.data.taskId);
    } catch (err) {
      reportFailure(this, err, { accepting: false });
    }
  },

  /**
   * 明确发布 —— 第二个独立动作。
   *
   * 幂等键在这里生成一次并留在页面上：重复点击复用同一个键，服务端按 §4.2 原样回
   * 第一次的状态码与响应体，因此只有一条提交。它**不**在每次点击时新建，
   * 那样重复点击就会变成两条。
   */
  async onConfirmTap() {
    if (this.data.submitting || this.data.readonly) return;

    const attemptKey = this.data.attemptKey || taskSubmit.newAttemptKey();
    // 内容在确认的这一刻锁定，先于网络往返：等回包再锁，中间那段时间还改得动。
    this.setData({
      submitting: true,
      confirmed: true,
      locked: true,
      attemptKey,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    try {
      await taskSubmit.complete({
        taskId: this.data.taskId,
        gates: GATE_PATHS,
        draft: this.data.preview ? this.data.preview.draft : null,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      this.setData({ submitting: false, stage: 'done' });
    } catch (err) {
      // 内容解锁，否则教师改不了缺的那一步。
      this.setData({ locked: false, confirmed: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        // 把闸门自己的话原样给教师 —— present() 的兜底会把它换成
        // 「操作未能完成，请稍后再试」，那句话不告诉他缺了哪一步。
        this.setData({
          submitting: false,
          errorText: err.message,
          errorRequestId: '',
          errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  /** 回到详情。详情页的 onShow 会重读，所以看板与详情不必手工刷新。 */
  onBackTap() {
    wx.navigateBack();
  },
});
