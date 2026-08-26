/**
 * 发布家长评价 — APP-STRUCTURE.md screen id `ParentEvalPublish`（2026-08-26 收录）。
 *
 * 原型 parent-evaluation-publish.html：类型、评价说明、发布，加一列过往各期的进度。
 *
 * ── 教师在这里写的是什么 ────────────────────────────────────────────────────
 *
 * **是给家长看的说明（`evaluation_prompt`），不是家长的答案。** 家长自己的
 * `evaluation_text` 写在家长端的月度／学期评价页，也在那一端把关。`db_parent_evaluation`
 * 是家长端的 canonical object（spec 05 的 cross_app_rule），教师端只发起一期，
 * `requested_by_teacher_id` 由会话派生，客户端不送（§7.3 / DO-NOT-BUILD 8）。
 *
 * 但说明本身是**教职工文本**，而且会出现在家长的屏幕上，所以它同样走 ADR-0016 第二行
 * 的预览后发布。
 *
 * 原型那两个 `<select>`（类型、月份）在这里都是滚轮：WXML 没有下拉列表（ADR-0017 豁免 1）。
 * 月份**不给选择位** —— 与月度评价页同一条判断：能挑月份就等于能补写或提前写。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/** 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。说明只有文字。 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    types: evaluation.PARENT_EVAL_TYPES.map((t) => ({ key: t.value, label: t.label })),
    draft: { evaluation_type: 't1', evaluation_period: '', evaluation_prompt: '' },
    periodLabel: '',
    limits: { evaluation_prompt: evaluation.PROMPT_TEXT_MAX },
    blockers: [],
    counterLimit: false,

    rounds: [],

    stage: 'edit',
    previewedInFull: false,
    locked: false,
    submitting: false,
    attemptKey: null,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    const period = evaluation.currentMonth();
    this.setData({
      ready: true,
      draft: { ...this.data.draft, evaluation_period: period },
      periodLabel: evaluation.monthLabel(period),
    });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const rounds = await evaluation.parentEvalRounds();
      this.setData({ rounds, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  onTypePick(e) {
    this.setData({ draft: { ...this.data.draft, evaluation_type: e.detail.key }, blockers: [] });
  },

  onPromptInput(e) {
    const text = e.detail.value;
    this.setData({
      draft: { ...this.data.draft, evaluation_prompt: text },
      counterLimit: text.length >= evaluation.PROMPT_TEXT_MAX,
      blockers: [],
    });
  },

  onPreviewTap() {
    if (this.data.locked) return;
    const blockers = evaluation.parentEvalBlockers(this.data.draft);
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

  async onConfirmTap() {
    if (this.data.locked || this.data.submitting) return;

    const attemptKey = this.data.attemptKey || evaluation.newParentEvalKey();
    this.setData({
      submitting: true, locked: true, attemptKey,
      errorText: '', errorRequestId: '', errorCanRetry: false,
    });

    try {
      await evaluation.publishParentEval({
        gates: GATE_PATHS,
        draft: this.data.draft,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      this.setData({ submitting: false, stage: 'done' });
      // 过往各期要跟着变：刚发布的那一期现在也在列表里。
      await this.load();
    } catch (err) {
      this.setData({ locked: false });
      if (err instanceof moderation.ModerationError) {
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  onWriteAnother() {
    this.setData({
      stage: 'edit',
      draft: {
        evaluation_type: 't1',
        evaluation_period: this.data.draft.evaluation_period,
        evaluation_prompt: '',
      },
      previewedInFull: false,
      locked: false,
      attemptKey: null,
      blockers: [],
      counterLimit: false,
    });
  },

  onRoundTap(e) {
    evaluation.openParentEvalProgress(e.currentTarget.dataset.id);
  },
});
