/**
 * 教师寄语 — APP-STRUCTURE.md screen id `TeacherMessage`（2026-08-26 收录）。
 *
 * 原型 teacher-message.html：一张表单（收件人＋正文＋提交）加一张逐儿完成情况表。
 *
 * ── 三件要紧的事 ─────────────────────────────────────────────────────────────
 *
 * 1. **提交即终局。** 原型与 spec 05 都写着「提交后永久只读」。所以这一页没有编辑
 *    入口，已完成的那一格点进去是详情（只读），不是表单。服务端对已提交的对象回
 *    409，本页原样呈现 —— 不改写成「保存成功」。
 *
 * 2. **教职工文本走预览后发布**（ADR-0016 第二行，`HUMAN_PREVIEW_CONFIRM`）。预览与
 *    确认是两个独立动作：`utils/moderation` 在请求发出**之前**复核这两个布尔值，
 *    少一个就抛。这一条不是提示，它是把关本身。
 *
 * 3. **收件人是滚轮，不是下拉。** 原型用 `<select>`，WXML 没有这个原语
 *    （ADR-0017 豁免 1）。取值来自本班名册，条数约 30，`form-control-spec` 的三问
 *    第 3 问命中，所以是滚轮。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 一条，因为这一次写入只携带教职工文字这一类内容：`db_teacher_message` 没有
 * `file_id`，原型的占位符也写着「仅支持文字」。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    columns: evaluation.MESSAGE_COLUMNS,
    rows: [],
    // `hl-picker-row` 的选项形状是 [{ key, label }]，选中值是 key，不是下标。
    targets: [],

    draft: { child_id: 'all', message_text: '' },
    limits: { message_text: evaluation.MESSAGE_TEXT_MAX },
    blockers: [],
    counterLimit: false,

    stage: 'edit',
    previewedInFull: false,
    locked: false,
    submitting: false,
    attemptKey: null,
    doneText: '',
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const rows = await evaluation.messageRoster();
      this.setData({
        rows,
        targets: evaluation.messageTargets(rows),
        loading: false,
      });
      return rows;
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  /** 收件人。组件只在确认时发这个事件，滑动过程中不发（form-control-spec §4）。 */
  onTargetPick(e) {
    this.setData({ draft: { ...this.data.draft, child_id: e.detail.key }, blockers: [] });
  },

  onTextInput(e) {
    const text = e.detail.value;
    this.setData({
      draft: { ...this.data.draft, message_text: text },
      counterLimit: text.length >= evaluation.MESSAGE_TEXT_MAX,
      blockers: [],
    });
  },

  /**
   * 进预览。拦阻项先说清楚，不让教师点了提交才知道差什么。
   *
   * 预览绑的是**将要发出的那份正文**，不是另拼一份好看的文字：看过的与发出的必须
   * 是同一份，否则「完整预览」就没有把关的意义。
   */
  onPreviewTap() {
    if (this.data.locked) return;
    const blockers = evaluation.messageBlockers(this.data.draft);
    if (blockers.length) {
      this.setData({ blockers });
      return;
    }
    this.setData({ stage: 'preview', previewedInFull: false });
  },

  /** 预览滚到底＝完整看过。这是 `previewedInFull` 唯一的来源。 */
  onPreviewEnd() {
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', previewedInFull: false });
  },

  /**
   * 确认提交。
   *
   * 幂等键生成一次、重发复用（§4.2）：网络超时后再点一次，服务端认得出这是同一次
   * 逻辑提交，只产生一份寄语。
   */
  async onConfirmTap() {
    if (this.data.locked || this.data.submitting) return;

    const attemptKey = this.data.attemptKey || evaluation.newMessageKey();
    // 内容在确认的这一刻锁定，先于网络往返：等回包再锁，中间那段时间还改得动。
    this.setData({
      submitting: true, locked: true, attemptKey,
      errorText: '', errorRequestId: '', errorCanRetry: false,
    });

    try {
      const saved = await evaluation.submitMessage({
        gates: GATE_PATHS,
        draft: this.data.draft,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      const count = (saved && saved.items ? saved.items.length : 1);
      this.setData({
        submitting: false,
        stage: 'done',
        doneText: this.data.draft.child_id === 'all'
          ? `已为 ${count} 名幼儿提交寄语。寄语提交后不能修改。`
          : '已提交。寄语提交后不能修改。',
      });
      // 完成情况表要跟着变：刚提交的那一格现在是已完成。
      await this.load();
    } catch (err) {
      // 内容解锁，否则教师改不了缺的那一步。
      this.setData({ locked: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  /** 再写一条：回到空白表单，换一个幂等键 —— 这是新的一次逻辑提交。 */
  onWriteAnother() {
    this.setData({
      stage: 'edit',
      draft: { child_id: 'all', message_text: '' },
      previewedInFull: false,
      locked: false,
      attemptKey: null,
      blockers: [],
      counterLimit: false,
      doneText: '',
    });
  },

  /**
   * 点完成情况表的一格。
   *
   * 已完成的进详情（只读）；未完成的把表单的收件人切到这名幼儿 —— 与原型一致，
   * 原型那一格的说明就是「未完成则定位到上方填写」。
   */
  onCellTap(e) {
    const childId = Number(e.detail.rowKey);
    const row = this.data.rows.find((r) => r.key === e.detail.rowKey);
    if (!row) return;
    if (row.done) {
      evaluation.openMessageDetail(childId);
      return;
    }
    this.setData({
      stage: 'edit',
      draft: { ...this.data.draft, child_id: e.detail.rowKey },
      blockers: [],
    });
    wx.showToast({ title: `请为 ${row.name} 填写寄语`, icon: 'none' });
  },
});
