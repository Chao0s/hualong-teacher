/**
 * 填写五大领域量表 — APP-STRUCTURE.md screen id `Scale`（票据 18）。
 *
 * 两个阶段，顺序不可跳，与 packages/co-education 的发布页同一套：
 *
 *   fill     教师逐题拨滚轮。每一次拨动立刻存成草稿，**存在服务端**。
 *   preview  最后一题落下时进入。教师读完 124 题的最终答案，再另做一次确认才提交。
 *   done     已提交，内容锁定。c1 之后没有回头路 —— 撤销评分不在转移图上。
 *
 * ── 中断后回来接着填，靠的是什么 ─────────────────────────────────────────────
 *
 * **靠服务端，不靠本地缓存。** 每拨一次滚轮就是一次
 * `PUT /children/{id}/child-assessment/items/{item_id}`，契约的 `incremental_save_rule`
 * 就是这么定的。页面进来时读回 `GET /children/{id}/child-assessment`，已评的题原样回来，
 * **未评的题没有那一列**。124 题不可能一次填完，所以这里没有「保存」按钮 —— 一个要按的
 * 保存按钮，等于把「会不会丢」变成教师的责任。
 *
 * 本地缓存刻意没有：两处草稿会不一致，而不一致时哪一份算数没有权威说过。
 *
 * ── 提交是最后一题那一次写入 ─────────────────────────────────────────────────
 *
 * 契约上没有单独的提交端点：`completed_count` 达到 `required_count` 时状态由 c2 派生成
 * c1。所以「提交」就是最后一题的那一次 PUT，它必须过 `HUMAN_PREVIEW_CONFIRM`。页面因此
 * 在拨动最后一题时**不发请求**，先进预览；`services/assessment` 那一侧的 `scoreItemDraft`
 * 也会拒绝把最后一题当草稿写，两道都在，缺一才要紧。
 *
 * ── 选择控件的形态 ───────────────────────────────────────────────────────────
 *
 * 打分用**原生滚轮**（`hl-picker-row`），幼儿选择也用滚轮（`hl-child-picker`
 * `mode="single"`），领域切换用**横排标签**。三处都按 form-control-spec.md §1 的三问判：
 * 打分的五个选项文字是这一题的锚点，124 题各不相同、取值来自服务端下发的题库，第 2 问
 * 「取值固定不随数据变」答否，第 3 问命中；领域五个、取值固定，第 2 问命中。
 *
 * 假期是**只读状态，不是错误**：页面照常打开，写入区换成一行理由。教师不该点进一个会
 * 当面拒绝他的按钮。
 */

const guard = require('../../../../utils/guard');
const assessment = require('../../../../services/assessment');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * **一条，因为这一次写入只携带教职工文字这一类内容**：契约的 `ChildAssessmentItemWrite`
 * 是 `additionalProperties: false` 且只有一个 1—5 的整数，没有 `file_id`，本页也没有
 * 任何图片入口。将来若给评估接上佐证材料，这里加 `IMAGE_MEDIA_CHECK_ASYNC` 并把
 * `imageCount` 接上真实张数，两处一起改，漏一处 `assertGate` 会拦下来。
 */
const GATE_PATHS = [moderation.GATES.HUMAN_PREVIEW_CONFIRM];

Page({
  data: {
    ready: false,
    loading: true,

    // 名册，兼作幼儿选择器的选项来源。`GET /child-assessments` 本身就是名册型集合，
    // 所以这一页不必再去问第二个名册端点。
    children: [],
    childId: 0,
    childValue: [],
    childName: '',

    // 题库。**页面不持有题目**：这一份来自 `GET /scales/{code}/{version}`。
    scaleLabel: '',
    domains: [],
    activeDomain: '',
    items: [],

    progress: null,
    progressLabel: '',
    remaining: 0,
    remainingHint: '',

    readonly: false,
    readonlyReason: '',

    stage: 'fill',
    // 最后一题的那一笔，**还没有发出去**。它停在这里等完整预览与确认。
    pendingFinal: null,
    preview: null,
    previewedInFull: false,
    locked: false,

    saving: false,
    submitting: false,
    // 一次逻辑提交的幂等键，生成一次、重发复用（§4.2）。
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
      const [scale, children] = await Promise.all([
        assessment.scaleDefinition(),
        assessment.listChildAssessments(),
      ]);
      this.setData({
        loading: false,
        children: children.map((c) => ({ child_id: c.child_id, child_name: c.child_name })),
        scaleLabel: `${scale.scale_code} ${scale.scale_version} · 共 ${scale.itemCount} 题`,
        domains: scale.domains.map((d) => ({ code: d.code, name: d.name, count: d.items.length })),
        activeDomain: scale.domains[0] ? scale.domains[0].code : '',
      });
      this.scale = scale;
      if (this.data.childId) await this.loadChild(this.data.childId);
      else this.renderItems();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /**
   * 换一名幼儿：读回他这一份评估，**已评的题原样回来**。
   *
   * 这就是「中断后回来不用重填」的落点。换人也走这里，所以两件事只有一份代码。
   */
  async loadChild(childId) {
    const child = this.data.children.find((c) => c.child_id === childId);
    if (!child) return;
    this.setData({
      childId,
      childValue: [childId],
      childName: child.child_name,
      stage: 'fill',
      pendingFinal: null,
      preview: null,
      previewedInFull: false,
      locked: false,
      attemptKey: '',
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });
    try {
      const progress = await assessment.childAssessment(child, this.scale.itemCount);
      this.applyProgress(progress);
    } catch (err) {
      reportFailure(this, err, {});
    }
  },

  onChildChange(e) {
    const childId = Number((e.detail.childIds || [])[0]) || 0;
    if (!childId || childId === this.data.childId) return;
    return this.loadChild(childId);
  },

  /**
   * 把一份进度铺到界面上：进度数字、只读判定、当前领域的题目。
   *
   * 只读的**理由**由服务层给（`writeEntry` 返回理由而不是真假），页面照原样显示。
   */
  applyProgress(progress) {
    const entry = assessment.writeEntry(progress);
    const remaining = assessment.remainingCount(progress);
    this.setData({
      progress,
      progressLabel: `${progress.progress_label}（${progress.status_label}）`,
      remaining,
      remainingHint: progress.done
        ? ''
        : remaining === 1
          ? '还差最后 1 题。填完它会先进入完整预览，确认后才提交。'
          : `还差 ${remaining} 题。已填的会存下来，中途退出再进来接着填。`,
      readonly: !entry.open,
      readonlyReason: entry.reason,
      stage: progress.done ? 'done' : 'fill',
      locked: progress.done,
    });
    this.renderItems();
  },

  onDomainTap(e) {
    this.setData({ activeDomain: e.currentTarget.dataset.code });
    this.renderItems();
  },

  /**
   * 当前领域的题目，带上已评的分。
   *
   * **题目来自服务层，页面不持有。** 这里做的只有一件事：把 `scores` 里的分接到对应的
   * 题上。未评的题 `value` 是空串 —— 空串是「请选择」，不是 0 分，也不是原型那样预设的
   * 4 分（契约明写不得如此）。
   */
  renderItems() {
    if (!this.scale) return;
    const domain = this.scale.domains.find((d) => d.code === this.data.activeDomain);
    const scores = (this.data.progress && this.data.progress.scores) || {};
    this.setData({
      items: ((domain && domain.items) || []).map((item) => ({
        ...item,
        value: scores[item.item_id] === undefined ? '' : String(scores[item.item_id]),
      })),
    });
  },

  /**
   * 拨一次滚轮。
   *
   * 两条出口，是同一个端点的两个已登记转移：
   *   不是最后一题  立刻存草稿，一次网络往返，不打断填写。
   *   是最后一题    **不发请求**，冻结这一笔并进入预览。落下它就是提交。
   */
  async onScorePick(e) {
    if (this.data.readonly || this.data.locked || this.data.saving) return;
    const itemId = e.currentTarget.dataset.itemId;
    const score = Number(e.detail.key);
    const progress = this.data.progress;
    if (!progress || !score) return;

    if (assessment.isFinalItem(progress, itemId)) {
      this.enterPreview(itemId, score);
      return;
    }

    this.setData({ saving: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const updated = await assessment.scoreItemDraft({ progress, itemId, score });
      // 服务端回的是这次评估的最新进度（题项列数由它算，客户端不自己数）。分只在本地
      // 接上一笔，因为响应里没有题项明细 —— 再读一次整份是一趟白跑的往返。
      this.applyProgress({
        ...progress,
        ...assessmentPatch(updated),
        scores: { ...progress.scores, [itemId]: score },
      });
      this.setData({ saving: false });
    } catch (err) {
      reportFailure(this, err, { saving: false });
    }
  },

  /**
   * 进入预览。把最后一笔与已填的 123 笔冻结成最终内容，之后提交的就是这一份。
   *
   * **一个请求也不发**：完整性在这里已经满足（这是第 124 题），要问的只剩教师看没看过。
   */
  enterPreview(itemId, score) {
    const progress = this.data.progress;
    const answers = { ...progress.scores, [itemId]: score };
    const rows = [];
    this.scale.domains.forEach((domain) => {
      domain.items.forEach((item) => {
        rows.push({
          item_id: item.item_id,
          domain_name: domain.name,
          item_name: item.item_name,
          score: answers[item.item_id],
        });
      });
    });
    this.setData({
      stage: 'preview',
      pendingFinal: { itemId, score },
      previewedInFull: false,
      preview: {
        rows,
        // 教师在预览里看到的最后一笔，与将要发出的请求体，来自同一次构造。
        body: assessment.buildItemBody(score),
        finalLabel: `${itemId} · ${score} 分`,
        count: rows.length,
      },
    });
  },

  /**
   * 预览滚到底。这是「完整预览」的落点 —— 打开预览不算，读到最后一题才算。
   * 内容短到不需要滚动时，`bindscrolltolower` 在渲染后立即触发，语义一致。
   */
  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  /** 返回修改：上一次的完整预览随之作废，最后一笔也退回未落下的状态。 */
  onBackToFill() {
    if (this.data.locked) return;
    this.setData({
      stage: 'fill', pendingFinal: null, preview: null, previewedInFull: false,
    });
  },

  /**
   * 明确提交 —— 第二个独立动作。
   *
   * 幂等键在这里生成一次并留在页面上，重复点击复用同一个，服务端按 §4.2 原样回第一次的
   * 状态码与响应体，因此**只产生一份已提交的量表**。它**不**在每次点击时新建。
   *
   * 请求体里没有 `teacher_id`、没有 `submitted_at`、没有 `completed_count` —— 三者都由
   * 服务端设值或派生，客户端在 `buildItemBody` 里就没造它们（DO-NOT-BUILD 8／9）。
   */
  async onConfirmTap() {
    if (this.data.readonly || this.data.submitting || this.data.locked) return;
    const pending = this.data.pendingFinal;
    if (!pending) return;

    const attemptKey = this.data.attemptKey || assessment.newAttemptKey();
    // 内容在确认的这一刻锁定，先于网络往返：等回包再锁，中间那段时间还改得动。
    this.setData({
      submitting: true,
      locked: true,
      attemptKey,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    try {
      const updated = await assessment.completeAssessment({
        progress: this.data.progress,
        itemId: pending.itemId,
        score: pending.score,
        gates: GATE_PATHS,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      this.applyProgress({
        ...this.data.progress,
        ...assessmentPatch(updated),
        scores: { ...this.data.progress.scores, [pending.itemId]: pending.score },
      });
      this.setData({
        submitting: false,
        stage: 'done',
        readonly: true,
        readonlyReason: '已提交，内容已锁定，不能再修改。现在可以看这名幼儿的五维雷达图。',
      });
    } catch (err) {
      // 内容解锁，否则教师改不了缺的那一步。
      this.setData({ locked: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。把闸门
        // 自己的话原样给教师 —— 兜底文案不告诉他缺了哪一步。
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  /** 提交完了去看图。链的下一节。 */
  onRadarTap() {
    assessment.openRadar(this.data.childId);
  },

  /**
   * 评价五维图的入口。原型的教研培训入口页只有三张快捷入口卡，五维图不在其中，
   * 所以它从这里进（园方 2026-08-26 裁定）。与上面那个按钮不是一回事：那个带着
   * 当前幼儿去看他自己的雷达图，这个进的是本班的五维图聚合页。
   */
  onFiveChartTap() {
    assessment.openFiveChart();
  },
});

/**
 * 服务端回的进度里，页面要接的那几个字段。
 *
 * 只取这五个而不是整份铺开，是因为 `scores` 不在响应里 —— 整份铺开会把本地那份答案表
 * 抹成 undefined，而页面正靠它显示已填的分。
 */
function assessmentPatch(row) {
  return {
    child_assessment_id: row.child_assessment_id,
    scale_code: row.scale_code,
    scale_version: row.scale_version,
    required_count: row.required_count,
    completed_count: row.completed_count,
    child_assessment_status: row.child_assessment_status,
    done: row.child_assessment_status === 'c1',
    progress_label: `${row.completed_count} / ${row.required_count} 题`,
    status_label: row.child_assessment_status === 'c1' ? '已完成' : '草稿',
  };
}
