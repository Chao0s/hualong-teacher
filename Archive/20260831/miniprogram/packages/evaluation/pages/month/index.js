/**
 * 填写月度评价 — APP-STRUCTURE.md screen id `MonthEval`（票据 20）。
 *
 * 三个阶段，顺序不可跳，与 packages/co-education 的两个发布页同一套：
 *
 *   edit     选一名幼儿，写这个月的评价。
 *   preview  一屏完整预览。教师读到底，再另做一次确认才发布。
 *   done     已发布。`e3` 之后永久唯读 —— 契约里没有 e3→e1，也没有 e3→e2。
 *
 * ── 月份不是一个选择项 ───────────────────────────────────────────────────────
 *
 * 页面上**没有月份控件**。月份来自 `services/evaluation.currentMonth()`，它的唯一来源是
 * `utils/time.currentMonthKey`。原型 `teacher-monthly-form.html` 有一个 3—7 月的下拉，
 * 那是错的：月度评价填的是「这个月」，能挑月份就等于能补写上个月或提前写下个月，而
 * 家长端报告流按月排序，一次补写会让家庭看到一条时间上说不通的记录。
 *
 * 跨月后再进来显示的自然是新的月份，因为**没有任何一处记住过上一次的月份** —— 每次
 * `onLoad` 都现取。`now()` 是一个方法而不是直接写 `Date.now()`，因为跨月这件事必须测得了。
 *
 * ── 为什么没有「保存草稿」 ───────────────────────────────────────────────────
 *
 * `PUT /home-school/month-evals` 被 **G51** 阻断：`month_eval_status` 的 `e1`／`e2` 分界
 * 与 `saved_at` 在哪一步落值都没有决议。一个「保存草稿」按钮必须回答「存成 e1 还是 e2」，
 * 而那正是未决的那一问，所以这一页没有这个按钮，也没有自动保存。写入只发生在教师确认
 * 发布的那一刻。理由与处置写在 `services/evaluation` 的头注第 3 条，已记进交接。
 *
 * ── 选择控件的形态 ───────────────────────────────────────────────────────────
 *
 * 幼儿选择用**原生滚轮**（`hl-child-picker` `mode="single"`）：按 form-control-spec.md §1
 * 的三问，第 1 问「是否多选」答否，第 2 问「≤6 项且取值固定」答否（一班约 30 人，取值来自
 * 服务端名册），第 3 问命中。页面上**没有第二种选择形态** —— 小程序里本来就不存在下拉
 * 列表，`<select>` 没有 WXML 对应物。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * **一条，因为这一次写入只携带教职工文字这一类内容。** `MonthEvalDraft` 有 `file_id`，
 * 但本页不提供相册引用入口（E7 的幼儿相册在契约里没有教师端端点，见交接），所以
 * `file_id` 恒为空数组，图片这一类内容不在本次写入里。将来接上相册时，这里加
 * `IMAGE_MEDIA_CHECK_ASYNC` 并把 `imageCount` 接上真实张数，两处一起改，漏一处
 * `assertGate` 会拦下来。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,

    // 名册。`GET /child-assessments` 本身就是名册型集合，评价链三页共用它。
    children: [],
    childId: 0,
    childValue: [],
    childName: '',

    // 月份，只读。页面上没有改它的控件。
    monthKey: '',
    monthLabel: '',
    monthSummary: '',

    draft: null,
    limits: { eval_text: evaluation.EVAL_TEXT_MAX },
    blockers: [],

    readonly: false,
    readonlyReason: '',

    stage: 'edit',
    preview: null,
    previewedInFull: false,
    locked: false,

    submitting: false,
    // 一次逻辑发布的两个幂等键，生成一次、重发复用（§4.2）。
    attemptKeys: null,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  /**
   * 当前时刻。**可注入** —— 直接写 `Date.now()` 就测不了跨月，而「跨月后再进入显示的是
   * 新的月份」正是本票的第一条验收。
   */
  now() {
    return Date.now();
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, childId: Number((query || {}).child_id) || 0 });
    return this.load();
  },

  async load() {
    const monthKey = evaluation.currentMonth(this.now());
    try {
      const [children, month] = await Promise.all([
        evaluation.listChildren(),
        evaluation.listMonthEvals({ eval_month: monthKey }),
      ]);
      this.rows = month.items;
      this.setData({
        loading: false,
        monthKey,
        monthLabel: evaluation.monthLabel(monthKey),
        monthSummary: `${evaluation.monthLabel(monthKey)}：本班 ${children.length} 名幼儿，`
          + `已发布 ${month.items.filter((r) => r.done).length} 份。`,
        children: children.map((c) => ({ child_id: c.child_id, child_name: c.child_name })),
      });
      if (this.data.childId) this.applyChild(this.data.childId);
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  onChildChange(e) {
    const childId = Number((e.detail.childIds || [])[0]) || 0;
    if (!childId || childId === this.data.childId) return;
    this.applyChild(childId);
  },

  /**
   * 换一名幼儿。**已发布的那一份是只读的**，草稿这条路不存在（见头注），所以要么显示
   * 已发布的内容，要么是一张空表。
   */
  applyChild(childId) {
    const child = (this.data.children || []).find((c) => c.child_id === childId);
    if (!child) return;
    const existing = (this.rows || []).find((r) => r.child_id === childId) || null;
    const entry = evaluation.monthWriteEntry(existing);
    const draft = evaluation.emptyMonthDraft(childId, this.data.monthKey);
    if (existing && existing.done) draft.eval_text = existing.eval_text;
    this.setData({
      childId,
      childValue: [childId],
      childName: child.child_name,
      draft,
      blockers: [],
      readonly: !entry.open,
      readonlyReason: entry.reason,
      stage: existing && existing.done ? 'done' : 'edit',
      locked: Boolean(existing && existing.done),
      preview: null,
      previewedInFull: false,
      attemptKeys: null,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });
  },

  /** 改动作废上一次的完整预览，理由与 packages/co-education 的两个发布页相同。 */
  onTextInput(e) {
    if (this.data.readonly || this.data.locked) return;
    this.setData({
      draft: { ...this.data.draft, eval_text: e.detail.value },
      blockers: [],
      previewedInFull: false,
      preview: null,
      stage: 'edit',
    });
  },

  /**
   * 进入预览。**预览的内容就是将要发出的请求体**，同一次构造 —— 页面绑定 `preview.body`，
   * 不另拼一份好看的文字。两份就会有两份说法，而验收要的是逐字一致。
   */
  onPreviewTap() {
    if (this.data.readonly || this.data.locked) return;
    const blockers = evaluation.monthBlockers(this.data.draft);
    if (blockers.length) {
      this.setData({ blockers });
      return;
    }
    this.setData({
      stage: 'preview',
      previewedInFull: false,
      preview: {
        body: evaluation.buildMonthBody(this.data.draft, this.now()),
        childName: this.data.childName,
        monthLabel: this.data.monthLabel,
      },
    });
  },

  /**
   * 预览滚到底。这是「完整预览」的落点 —— 打开预览不算，读到最后才算。
   * 内容短到不需要滚动时，`bindscrolltolower` 在渲染后立即触发，语义一致。
   */
  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  /** 返回修改：上一次的完整预览随之作废。 */
  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', preview: null, previewedInFull: false });
  },

  /**
   * 明确发布 —— 第二个独立动作。
   *
   * 两个幂等键在这里生成一次并留在页面上，重复点击复用同一对，服务端按 §4.2 原样回第一次
   * 的状态码与响应体，因此**只产生一份月度评价**。它们**不**在每次点击时新建。
   */
  async onConfirmTap() {
    if (this.data.readonly || this.data.locked || this.data.submitting) return;
    if (!this.data.preview) return;

    const attemptKeys = this.data.attemptKeys || evaluation.newMonthKeys();
    // 内容在确认的这一刻锁定，先于网络往返：等回包再锁，中间那段时间还改得动。
    this.setData({
      submitting: true,
      locked: true,
      attemptKeys,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    try {
      await evaluation.publishMonthEval({
        gates: GATE_PATHS,
        draft: this.data.draft,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        keys: attemptKeys,
        nowMs: this.now(),
      });
      this.setData({
        submitting: false,
        stage: 'done',
        readonly: true,
        readonlyReason: '已发布，内容已锁定，不能再修改。现在可以看这名幼儿的综合评估报告。',
      });
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

  /** 链的下一节：这名幼儿的综合评估报告。 */
  onReportTap() {
    if (!this.data.childId) return;
    evaluation.openReport(this.data.childId);
  },
});
