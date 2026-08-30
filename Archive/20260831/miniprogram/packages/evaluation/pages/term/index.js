/**
 * 填写学期评价 — APP-STRUCTURE.md screen id `TermEval`（票据 20）。
 *
 * 三个阶段，与月度评价同一套：edit -> preview -> done。**一次写成 c1**：`db_term_eval`
 * 的值域只有 c1／c2，而全库没有任何决议为它定义服务端草稿（契约原话：`c2` 目前没有任何
 * 写入者）。所以这一页没有草稿，也没有自动保存 —— 契约不发明草稿端点，客户端也不发明。
 *
 * ── 五大领域只读，一处也不重复录入 ───────────────────────────────────────────
 *
 * 原型 `teacher-term-form.html` 曾有一个「五大领域评价」textarea，E6／F17 与
 * `05 home-school-spec.md` 的 content_rule 已经把它删掉了：五大领域由 124 题量表逐题打分、
 * 领域分即时聚合（票据 18），再用文字写一遍是重复劳动，而且两份说法可能互相矛盾 ——
 * 文字写「语言发展良好」而量表语言领域均分 2.3，家长该信哪一个。
 *
 * 所以这一页把量表结果**读出来摆在旁边**，一个写入控件也不给它：五个领域的均分与它们
 * 画出来的那张图，都来自 `services/evaluation` 转出的票据 18 的 `radarModel`，本页一次
 * 算术也不做。`db_term_eval` 只有 `eval_text` 一个内容列，页面上因此只有一个输入框。
 *
 * ── 假期是只读状态，不是错误 ─────────────────────────────────────────────────
 *
 * 没有进行中的学期时，页面照常打开，写入区换成一行中文说明（§5.4／§6.4：客户端预先禁用
 * 是体贴，服务端仍独立回 409 no_active_term）。**不弹窗** —— 教师不该点进一个会当面拒绝
 * 他的按钮，也不该被告知「出错了」，因为假期是季节不是故障。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const moderation = require('../../../../utils/moderation');
const { drawRadar } = require('../../../../utils/radar-canvas');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 一条，理由与月度评价页逐字相同：`TermEvaluationWrite` 有 `file_id`，但本页不提供相册
 * 引用入口（E7 的幼儿相册在契约里没有教师端端点），所以本次写入不携带图片这一类内容。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,

    children: [],
    childId: 0,
    childValue: [],
    childName: '',

    // 名册进度：谁填了、谁还没填。整取不分页（§3.5）。
    progress: [],
    progressSummary: '',

    // 五大领域的结果，**只读**。来自票据 18 的量表，页面不重新采集也不重新计算。
    radar: null,
    radarHint: '',

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
    attemptKey: '',

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, childId: Number((query || {}).child_id) || 0 });
    return this.load();
  },

  async load() {
    try {
      const [children, progress] = await Promise.all([
        evaluation.listChildren(),
        evaluation.listTermEvaluations(),
      ]);
      this.setData({
        loading: false,
        children: children.map((c) => ({ child_id: c.child_id, child_name: c.child_name })),
        progress,
        progressSummary: `本班 ${progress.length} 名幼儿，已提交 `
          + `${progress.filter((r) => r.done).length} 份学期评价。`,
      });
      if (this.data.childId) await this.loadChild(this.data.childId);
      else this.applyEntry(null);
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
    return this.loadChild(childId);
  },

  /**
   * 换一名幼儿：读回他这一份学期评价与他的量表结果。
   *
   * 两个并发请求，互不依赖。量表那一份只用来**显示**，它的缺席（还没评）不影响写学期评语。
   */
  async loadChild(childId) {
    const child = (this.data.children || []).find((c) => c.child_id === childId);
    if (!child) return;
    this.setData({
      childId,
      childValue: [childId],
      childName: child.child_name,
      stage: 'edit',
      preview: null,
      previewedInFull: false,
      locked: false,
      attemptKey: '',
      blockers: [],
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });
    try {
      // 调的是只取那张图的 `childRadar`，不是报告页那个把四份一起读回来的 `report` ——
      // 这一页用不到成长档案与月度评价，读它们只是三趟白跑的往返。
      const [existing, radar] = await Promise.all([
        evaluation.termEvaluation(childId),
        evaluation.childRadar(childId),
      ]);
      const draft = evaluation.emptyTermDraft();
      if (existing) draft.eval_text = existing.eval_text;
      this.setData({ draft, radar });
      this.applyEntry(existing);
      this.drawRadar();
    } catch (err) {
      reportFailure(this, err, {});
    }
  },

  /** 只读判定的**理由**由服务层给，页面照原样显示。 */
  applyEntry(existing) {
    const entry = evaluation.termWriteEntry(existing);
    this.setData({
      readonly: !entry.open,
      readonlyReason: entry.reason,
      locked: Boolean(existing && existing.done),
      stage: existing && existing.done ? 'done' : 'edit',
      radarHint: this.data.radar ? '' : '这名幼儿的五大领域量表还没有结果，填完量表后这里才有数据。',
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
   * 进入预览。**预览的内容就是将要发出的请求体**，同一次构造。
   *
   * 五大领域的结果不进请求体（它不是 `TermEvaluationWrite` 的字段），所以预览里它以
   * 「随这份评价一并呈现给家庭」的身份出现，与逐字一致那一条不冲突：逐字一致说的是
   * 提交内容，而提交内容只有 `eval_text` 与 `file_id`。
   */
  onPreviewTap() {
    if (this.data.readonly || this.data.locked) return;
    const blockers = evaluation.termBlockers(this.data.draft);
    if (blockers.length) {
      this.setData({ blockers });
      return;
    }
    this.setData({
      stage: 'preview',
      previewedInFull: false,
      preview: {
        body: evaluation.buildTermBody(this.data.draft),
        childName: this.data.childName,
      },
    });
  },

  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', preview: null, previewedInFull: false });
  },

  /**
   * 明确提交 —— 第二个独立动作。
   *
   * 幂等键生成一次并留在页面上，重复点击复用同一个，服务端按 §4.2 原样回第一次的状态码
   * 与响应体，因此**只产生一份学期评价**。
   */
  async onConfirmTap() {
    if (this.data.readonly || this.data.locked || this.data.submitting) return;
    if (!this.data.preview) return;

    const attemptKey = this.data.attemptKey || evaluation.newTermKey();
    this.setData({
      submitting: true,
      locked: true,
      attemptKey,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    try {
      await evaluation.submitTermEvaluation({
        gates: GATE_PATHS,
        childId: this.data.childId,
        draft: this.data.draft,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      this.setData({
        submitting: false,
        stage: 'done',
        readonly: true,
        readonlyReason: '已提交，内容已锁定，不能再修改。现在可以看这名幼儿的综合评估报告。',
      });
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

  /**
   * 画那张只读的五维雷达图。
   *
   * 绘图码在 `utils/radar-canvas`，与票据 18 的雷达图页是同一份 —— 两个分包各抄一遍就会
   * 有两种画法。量、放大、清屏三步留在页面里，那是页面的生命周期。
   *
   * **五个轴齐了才画**：缺轴的多边形合不拢，硬画出来的那条边是编的。
   */
  async drawRadar() {
    const radar = this.data.radar;
    if (!radar || !radar.can_draw) return;
    const hit = await measureCanvas('#term-radar');
    if (!hit) return;

    const canvas = hit.node;
    const width = hit.width;
    const height = hit.height;
    const ctx = canvas.getContext('2d');
    const dpr = pixelRatio();

    // 后备缓冲 = CSS 尺寸 × 像素比。设 width／height 会同时清空画布并复位变换矩阵，
    // 所以 scale 必须排在它们之后。
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    drawRadar(ctx, width, height, radar);
  },

  onReportTap() {
    if (!this.data.childId) return;
    evaluation.openReport(this.data.childId);
  },
});

/** 量到画布节点。选择器落空回 null —— 空状态下画布根本没渲染，量不到是正常的。 */
function measureCanvas(selector) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const hit = res && res[0];
        resolve(hit && hit.node ? hit : null);
      });
  });
}

/** 屏幕倍率。`getWindowInfo` 是 `getSystemInfo` 拆分后承接 `pixelRatio` 的那一个。 */
function pixelRatio() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return (info && info.pixelRatio) || 1;
}
