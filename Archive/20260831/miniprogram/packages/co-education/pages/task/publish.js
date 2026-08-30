/**
 * 教师发布亲子任务 — APP-STRUCTURE.md screen id `TaskPublish`（票据 19）。
 *
 * 三个阶段与在园时光发布页同一套（edit / preview / done），理由也相同：完整预览与明确
 * 发布是两个独立条件，缺一 `utils/moderation` 在请求发出之前就拒绝。
 *
 * ── 这一页是整个教师端唯一提交计划时刻的地方 ────────────────────────────────
 *
 * `start_at` 与 `due_at` 在契约 §1.2 的**计划时刻白名单**上，是全客户端仅有的两个由人
 * 挑选、由客户端提交的时间。三条规则一起成立，缺一这一页就写错了：
 *
 *   1. 偏移量是 `+08:00` **字面量**，不是换算。教师挑的 18:00 原样缀上偏移发出去，
 *      所以保存下来的就是 18:00，不会变成第二天凌晨。`Z` 或其他偏移量是 422，服务端
 *      不做转换。
 *   2. **本页一次 `new Date` 也没有。** 拼接在 `utils/time.fromPickerParts`，那里也没有。
 *      构造一个 Date 就等于把设备时区请了进来，而设备不是权威，园所才是。
 *   3. **白名单以外的时间列不由客户端提交**：`published_at`、`created_at`、`updated_at`
 *      都是事件时间戳，服务端设值；`term_id` 由服务端按 `start_at` 派生。`buildTaskBody`
 *      的白名单里因此一个都没有。
 *
 * ── 班级与幼儿选择器 ────────────────────────────────────────────────────────
 *
 * 直接复用在园时光那一个（`hl-child-picker`）。**这一页用它的只读姿态**：亲子任务按班
 * 下发，契约的 `ParentTaskWrite` 里没有 `child_id` —— 任务发给全班，家长各自提交。所以
 * 这里显示的是「这条任务发给谁」，不是一个选择位；做成可选会让教师以为能挑，而挑了也
 * 不生效。
 */

const guard = require('../../../../utils/guard');
const coEdu = require('../../../../services/co-education');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 只有文字一条：契约的 `ParentTaskWrite` 里没有 `file_id`，本页不携带图片。接上任务
 * 附件的端点时，这里加 `IMAGE_MEDIA_CHECK_ASYNC`，并把 `assertTaskGate` 的 `imageCount`
 * 接上真实张数 —— 两处一起改，漏一处 `assertGate` 会拦下来。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,

    className: '',
    children: [],

    draft: null,
    types: coEdu.TASK_TYPES,
    limits: coEdu.TASK_LIMITS,

    parentTaskId: 0,
    readonly: false,
    readonlyReason: '',

    stage: 'edit',
    blockers: [],
    previewedInFull: false,
    confirmed: false,
    locked: false,
    preview: null,

    submitting: false,
    attemptKeys: null,

    // 本班已有的任务，好让进度页有入口 —— 否则刚发布的那一条以外，其余都进不去。
    tasks: [],

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, draft: coEdu.emptyTaskDraft() });
    this.applyTermState();
    // 返回 promise：平台忽略它，但测试要等它读完，不必靠 sleep 猜时机。
    return this.load();
  },

  /** 假期：页面照常打开，写入区换成一行理由（§5.4 / §6.4）。 */
  applyTermState() {
    if (guard.canWriteThisTerm()) return;
    this.setData({ readonly: true, readonlyReason: '假期中暂不可发布任务，新学期开始后恢复' });
  },

  async load() {
    try {
      const [roster, page] = await Promise.all([coEdu.classRoster(), coEdu.listTasks({})]);
      this.setData({
        loading: false,
        className: roster.className,
        children: roster.children,
        tasks: page.items,
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  // ── 表单 ──────────────────────────────────────────────────────────────────

  /** 任务类型。t1／t2 是全部编码，没有「全部」，所以再点一次不取消。 */
  onTypeTap(e) {
    this.patchDraft('parent_task_type', e.currentTarget.dataset.key);
  },

  onTextInput(e) {
    this.patchDraft(e.currentTarget.dataset.field, e.detail.value);
  },

  /**
   * 日期与时刻各一个 `<picker>`，两个字符串拼成一个线上值。
   *
   * 分成两个是平台事实：`picker` 的 `date` 与 `time` 是两种 mode，没有一个既选日期又选
   * 时刻的原生形态。拼接在 `services/co-education.toPlannedTime` 里发生一次。
   */
  onPlannedChange(e) {
    this.patchDraft(e.currentTarget.dataset.field, e.detail.value);
  },

  /** 清掉截止时间。契约：`due_at` 为 null 表示不设截止，这是一个合法的选择。 */
  onClearDue() {
    if (this.data.readonly || this.data.locked) return;
    const draft = { ...this.data.draft, due_date: '' };
    this.setData({ draft, blockers: [], previewedInFull: false, confirmed: false, preview: null, stage: 'edit' });
  },

  /** 改动作废上一次的完整预览，理由同在园时光发布页。 */
  patchDraft(field, value) {
    if (this.data.readonly || this.data.locked) return;
    this.setData({
      draft: { ...this.data.draft, [field]: value },
      blockers: [],
      previewedInFull: false,
      confirmed: false,
      preview: null,
      stage: 'edit',
    });
  },

  // ── 预览与发布 ────────────────────────────────────────────────────────────

  /** 进入预览。把草稿冻结成最终内容；缺项时一个请求也不发。 */
  onPreviewTap() {
    if (this.data.readonly || this.data.locked) return;
    const blockers = coEdu.taskBlockers(this.data.draft);
    if (blockers.length) {
      this.setData({ blockers, errorText: '', errorRequestId: '', errorCanRetry: false });
      return;
    }
    const draft = { ...this.data.draft };
    const body = coEdu.buildTaskBody(draft);
    this.setData({
      stage: 'preview',
      blockers: [],
      previewedInFull: false,
      confirmed: false,
      preview: {
        draft,
        // 教师在预览里看到的，与将要发出的请求体，来自同一次构造。
        body,
        typeLabel: (coEdu.TASK_TYPES.find((t) => t.key === body.parent_task_type) || {}).label || '',
        // 预览里显示的就是**将要发出的那个字符串**，偏移量一并显示 —— 这一页最容易
        // 写错的东西因此在发布前是肉眼看得见的。
        startLabel: body.start_at,
        dueLabel: body.due_at || '不设截止',
      },
    });
  },

  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', previewedInFull: false, confirmed: false, preview: null });
  },

  /**
   * 明确发布 —— 第二个独立动作。
   *
   * 两个端点，一次逻辑尝试：先建草稿（NONE -> s1），再发布（s1 -> s2）。幂等键生成一次
   * 并留在页面上，重复点击复用同一对，所以**只产生一条任务**（§4.2）。
   */
  async onConfirmTap() {
    if (this.data.readonly || this.data.submitting || this.data.locked) return;

    const attemptKeys = this.data.attemptKeys || coEdu.newTaskKeys();
    this.setData({
      submitting: true, confirmed: true, locked: true, attemptKeys,
      errorText: '', errorRequestId: '', errorCanRetry: false,
    });

    const draft = this.data.preview ? this.data.preview.draft : null;
    try {
      let parentTaskId = this.data.parentTaskId;
      if (!parentTaskId) {
        const created = await coEdu.createTaskDraft({
          gates: GATE_PATHS, draft, previewedInFull: this.data.previewedInFull, confirmed: true,
          idempotencyKey: attemptKeys.create,
        });
        parentTaskId = created.parent_task_id;
        this.setData({ parentTaskId });
      } else {
        await coEdu.updateTaskDraft({
          gates: GATE_PATHS,
          parentTaskId,
          draft,
          previewedInFull: this.data.previewedInFull,
          confirmed: true,
        });
      }

      await coEdu.publishTask({
        gates: GATE_PATHS,
        parentTaskId,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKeys.publish,
      });

      this.setData({
        submitting: false,
        stage: 'done',
        readonly: true,
        // s2 之后时间、正文与 term_id 全部唯读，要改只能结束再新建（F16）。所以这句话
        // 说的是事实，不是一句客套。
        readonlyReason: '已发布给家长。发布后内容不能再改，需要调整只能结束这条任务再新建。',
      });
    } catch (err) {
      this.setData({ locked: false, confirmed: false });
      if (err instanceof moderation.ModerationError) {
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  /** 看这条任务的完成进度。进度页只读，这里只是它的入口。 */
  onProgressTap(e) {
    const id = Number(e.currentTarget.dataset.id) || this.data.parentTaskId;
    if (!id) return;
    coEdu.openTaskProgress(id);
  },

  onBackTap() {
    wx.navigateBack();
  },
});
