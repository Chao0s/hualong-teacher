/**
 * 研修详情页 — APP-STRUCTURE.md screen id `TrainDetail`.
 *
 * 研修通知（`training_content`）与研修材料都在这一页，材料点开就走取档（票据 14 验收项）。
 *
 * Read-only. §2.3: a training outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 *
 * **反馈是本页唯一的写入点（票据 16）**，也是整个教研培训模块唯一的写入点：办园理念页与
 * 研修列表页至今一个写入控件也没有。原型 training-detail.html 上的报名按钮属于票据 18，
 * 本轮仍然不做。
 *
 * 反馈的三个阶段，顺序不可跳（与任务材料提交那一票同一个形态）：
 *
 *   edit     教师写反馈。此时没有任何东西发得出去。
 *   preview  教师读**最终内容**。读到底才算完整预览 —— 这是把关本身，不是提示。
 *   done     已提交，内容锁定，不能再改。
 *
 * 「已提交」这个状态只在**这一次会话里**成立：契约的提交回执刻意不含
 * `feedback_status`，也没有对应的 GET（F9 的 Q58-ap1：作者不可查询状态）。教师退出再
 * 进来，客户端无从知道自己交过。这是契约缺口，记进交接，不靠本地缓存去编一个答案 ——
 * 换一台手机它就会说谎。
 */

const guard = require('../../../../utils/guard');
const training = require('../../../../services/training');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 只有文字一条：研修反馈是教职工文字，走使用条款＋完整预览＋明确发布（ADR-0016 第 1 行）。
 * F9 明写 `db_file_ref` 一概不接，所以这条写入不可能携带图片，也就没有第二条要声明。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,
    train: null,
    trainingId: 0,

    // 反馈入口。关着的时候是一行说明，不是一个会拒绝人的按钮。
    entry: { open: false, submitted: false, reason: '' },
    // 报名入口（原型 `#signupBlock`）。判定在服务层，页面只绑。
    registration: { show: false, open: false, registered: false, label: '', reason: '' },
    registering: false,
    stage: 'edit',
    feedbackText: '',
    feedbackTooLong: false,
    previewedInFull: false,
    preview: null,
    submitting: false,
    // 一次逻辑提交的幂等键，生成一次、重发复用（§4.2）。
    attemptKey: '',
    gateError: '',

    // 公开回馈流：只有已公开的那些，且活动仍在（F9）。
    feedbacks: [],
    feedbackCursor: null,
    loadingFeedback: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const trainingId = Number(query.training_id);
    if (!trainingId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少研修编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, trainingId });
    this.load(trainingId);
  },

  onRetryLoad() {
    if (!this.data.trainingId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.trainingId);
  },

  async load(trainingId) {
    try {
      const row = await training.trainingDetail(trainingId);
      this.setData({
        train: row,
        loading: false,
        // 学期状态是一等公民（票据 06）：本页读 canWriteThisTerm 决定的东西，
        // 从不自己看学期枚举。
        entry: training.feedbackEntry({
          train: row,
          canWrite: guard.canWriteThisTerm(),
          submitted: this.data.entry.submitted,
        }),
        registration: training.registrationEntry({ train: row }),
      });
      if (row.training_title) {
        wx.setNavigationBarTitle({ title: row.training_title });
      }
      await this.loadFeedback();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 打开一份研修材料。反馈由服务层统一给。 */
  onOpenMaterial(e) {
    const { id, name } = e.currentTarget.dataset;
    return training.openMaterial(this.data.trainingId, { file_id: id, file_name: name });
  },

  /**
   * 报名／取消报名（原型 `#signupBlock` 的那一枚）。
   *
   * 两个端点都没有请求体，也不携带用户内容，所以不过内容安全闸门。幂等键按「一次逻辑
   * 尝试」生成一次并留在页面上：连点两下复用同一个，服务端按 §4.2 回第一次的结果。
   *
   * 成功之后重读整页 —— 参与状态是服务端派生的，本地翻一个标志会与服务端各说各话。
   */
  async onRegistrationTap() {
    if (this.data.registering || !this.data.registration.open) return;
    const key = this.registrationKey || training.newAttemptKey();
    this.registrationKey = key;
    this.setData({ registering: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const call = this.data.registration.registered ? training.cancelRegistration : training.register;
      await call(this.data.trainingId, { idempotencyKey: key });
      // 一次逻辑尝试结束，下一次报名或取消是新的一次。
      this.registrationKey = null;
      this.setData({ registering: false });
      await this.load(this.data.trainingId);
    } catch (err) {
      this.registrationKey = null;
      reportFailure(this, err, { registering: false });
    }
  },

  /** 线上会议只提供复制，不内嵌外站（F9）。 */
  onCopyMeeting() {
    training.copyMeetingLink(this.data.train.meeting.url);
  },

  // ── 公开回馈流 ────────────────────────────────────────────────────────────

  /**
   * 读一页公开回馈。
   *
   * 读不到不当成整页失败：正文与材料已经在屏幕上了，为一段评论把它们换成一句错误，
   * 是拿走教师真正来看的东西。这一节自己空着，别的照旧。
   */
  async loadFeedback(cursor) {
    // 只挡「加载更多」的连点。首读不挡：`onLoad` 不把 load() 的 promise 交给任何人，
    // 所以首读可能与另一次首读并行，挡住它只会让其中一次悄悄不读，屏幕上是空的。
    // 两次首读写同一份数据，重复一次无害。
    if (cursor && this.data.loadingFeedback) return;
    this.setData({ loadingFeedback: true });
    try {
      const page = await training.listFeedback(this.data.trainingId, { cursor });
      this.setData({
        feedbacks: cursor ? this.data.feedbacks.concat(page.items) : page.items,
        feedbackCursor: page.nextCursor,
        loadingFeedback: false,
      });
    } catch (err) {
      this.setData({ loadingFeedback: false });
    }
  },

  onMoreFeedback() {
    if (!this.data.feedbackCursor) return;
    return this.loadFeedback(this.data.feedbackCursor);
  },

  // ── 写反馈 ────────────────────────────────────────────────────────────────

  /**
   * 草稿变了，预览就作废。
   *
   * 「预览内容与最终提交内容一致」只有这样才成立：改完字不重看一遍，上一次的完整预览
   * 就不再是对这份内容的把关。
   */
  onFeedbackInput(e) {
    if (this.data.entry.submitted) return;
    const text = e.detail.value;
    this.setData({
      feedbackText: text,
      feedbackTooLong: training.feedbackTooLong(text),
      previewedInFull: false,
      preview: null,
      gateError: '',
    });
  },

  /** 进入预览。把草稿**冻结**成最终内容，之后提交的就是这一份。 */
  onPreviewTap() {
    if (!this.data.entry.open || this.data.entry.submitted) return;
    if (this.data.feedbackTooLong) return;
    if (this.data.feedbackText.trim() === '') return;
    const draft = { feedback_text: this.data.feedbackText };
    this.setData({
      stage: 'preview',
      previewedInFull: false,
      preview: {
        draft,
        // 教师在预览里看到的字，与将要发出的请求体，来自同一次构造。
        body: training.buildFeedbackBody(draft),
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
    if (this.data.entry.submitted) return;
    this.setData({ stage: 'edit', previewedInFull: false, preview: null });
  },

  /**
   * 明确发布 —— 第二个独立动作。
   *
   * 幂等键在这里生成一次并留在页面上：重复点击复用同一个键，服务端按 §4.2 原样回第一次的
   * 状态码与响应体，因此只有一条反馈。它**不**在每次点击时新建，那样第二次点击会撞上
   * `UNIQUE(training_id, teacher_id)`，教师看到的是一句莫名其妙的「你已经提交过」。
   */
  async onConfirmTap() {
    if (this.data.submitting || !this.data.entry.open) return;

    const attemptKey = this.data.attemptKey || training.newAttemptKey();
    this.setData({ submitting: true, attemptKey, gateError: '', errorText: '', errorRequestId: '', errorCanRetry: false });

    try {
      await training.submitFeedback({
        trainingId: this.data.trainingId,
        gates: GATE_PATHS,
        draft: this.data.preview ? this.data.preview.draft : null,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      // 详情页立刻显示已提交，不必手工刷新（票据 16 验收项 5）。这一步不再读一次
      // 服务端 —— 契约没有查得到自己反馈的端点，读回来的只会是同一页详情。
      this.setData({
        submitting: false,
        stage: 'done',
        entry: training.feedbackEntry({ train: this.data.train, canWrite: true, submitted: true }),
      });
    } catch (err) {
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        // 把闸门自己的话原样给教师 —— present() 的兜底会把它换成
        // 「操作未能完成，请稍后再试」，那句话不告诉他缺了哪一步。
        this.setData({ submitting: false, gateError: err.message });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },
});
