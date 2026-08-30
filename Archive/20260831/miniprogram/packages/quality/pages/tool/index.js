/**
 * 办园质量评估 — APP-STRUCTURE.md screen id `QualityAssessment`（2026-08-27 收录）。
 *
 * 原型 `assessment-tool.html`：顶部一块进度摘要与三个筛选，下面九张可展开的一级指标
 * 卡，每题五个打分档加三档锚点，底部一条吸底的合计。
 *
 * 首页那张「质量评估」卡指的一直是这一页（01 home-spec.md 的 `btn_assessment`）。
 * 它此前没建，卡被接到了五大领域量表 —— 那是**另一件量具**，评的是一名幼儿。
 *
 * **这一页没有提交按钮**，那不是漏了：契约把作答登记成一个动作、两条转移，末题落下
 * 那一刻就是 s3。加一个提交按钮等于给一个不存在的动作画一扇门。
 *
 * Thin by the ticket-08 template：调服务、setData、答点击。题库、分档、等级、折叠
 * 与佐证规则都在 services/quality.js 与题库自身，这一页一个也不持有。
 */

const guard = require('../../../../utils/guard');
const quality = require('../../../../services/quality');
const { reportFailure } = require('../../../../utils/present');

/**
 * 题库 —— 在**本分包内**，由这一页 require 了再交给服务层。
 *
 * 服务层在主包，而主包 require 不到分包里的文件（平台规则：分包读得到主包，反过来
 * 不行）。所以这一份 68 KB 的题库跟着本分包走 —— 不进主包，用不到这一页的教师
 * 一个字节也不必下载。
 */
const TOOL = require('../../assets/tool');

// 原型 `.filters` 的三枚筛选。取值固定且只有三个，所以是横排标签不是滚轮
// （form-control-spec 三问第 2 问命中）。
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待评' },
  { key: 'low', label: '低分' },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    assessmentId: 0,
    options: [],
    evidenceRule: '',
    sections: [],
    visibleSections: [],
    summary: null,
    readonly: false,

    filters: FILTERS,
    activeFilter: 'all',
    // 展开的那一张一级指标卡。**一次只开一张**：九张全开等于把 120 题铺平，
    // 原型折叠它们不是装饰。
    openSection: '',
    // 展开了锚点的那道题。同理，一次一道。
    openAnchors: '',

    saving: '',
    staleTool: false,
    staleReason: '',
  },

  /**
   * 编号由首页那张卡带进来。**没有编号就不读** —— 契约里没有创建端点，替谁开一份
   * 是客户端不该做的决定。
   */
  onLoad(query) {
    if (!guard.requireSession()) return;
    const assessmentId = Number(query && query.assessment_id);
    if (!assessmentId) {
      this.setData({
        ready: true,
        loading: false,
        errorText: '没有指定评估，无法打开。请从首页的质量评估进入。',
        errorCanRetry: false,
      });
      return;
    }
    this.setData({ ready: true, assessmentId });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const view = await quality.load(this.data.assessmentId, TOOL);
      this.setData({ ...view, loading: false });
      this.applyFilter();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  /**
   * 筛选只影响**看得见哪些题**，不改任何一条数据。
   *
   * 一张一级指标卡在当前筛选下一题不剩时，整张卡不画 —— 留一张空卡等于让教师去
   * 数哪一张是空的。
   */
  applyFilter() {
    const filter = this.data.activeFilter;
    const keep = (item) => {
      if (filter === 'todo') return !item.scored;
      // 「低分」是工具自己的关注线：1 分与 2 分要复看，而 1 分还牵着佐证规则。
      if (filter === 'low') return item.scored && item.score <= 2;
      return true;
    };
    const visible = this.data.sections
      .map((s) => ({ ...s, items: s.items.filter(keep) }))
      .filter((s) => s.items.length > 0);
    this.setData({ visibleSections: visible });
  },

  onFilterTap(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.activeFilter) return;
    this.setData({ activeFilter: key });
    this.applyFilter();
  },

  /** 展开／收起一张一级指标卡。再点一次收起，所以同一个处理器两用。 */
  onSectionTap(e) {
    const { key } = e.currentTarget.dataset;
    this.setData({ openSection: this.data.openSection === key ? '' : key });
  },

  /** 展开／收起一道题的三档锚点。 */
  onAnchorTap(e) {
    const { code } = e.currentTarget.dataset;
    this.setData({ openAnchors: this.data.openAnchors === code ? '' : code });
  },

  /**
   * 打一个分。拨一次存一次，存在服务端。
   *
   * 本地先改再发，失败时把这一题退回原来的分 —— 教师看到的必须是服务端真的收下的
   * 那个分，而不是他刚才点的那个。
   */
  async onScoreTap(e) {
    if (this.data.readonly || this.data.saving) return;
    const { code, score } = e.currentTarget.dataset;
    const next = Number(score);

    const before = this.findItem(code);
    if (!before || before.score === next) return;

    this.patchItem(code, { score: next, scored: true, evidence_expected: next === 1 || next === 5 });
    this.setData({ saving: code });
    try {
      const saved = await quality.scoreItem(this.data.assessmentId, code, {
        score: next,
        note: before.note,
        idempotencyKey: quality.newScoreKey(),
      });
      // 计数与状态以服务端回的为准，本地不自己加一 —— 它们是派生值。
      this.setData({
        saving: '',
        // 末题落下时服务端把状态推到 s3，这一页因此变只读。没有第二个动作。
        readonly: saved.assessment_status === 's3',
        summary: {
          ...this.data.summary,
          done: saved.completed_count,
          percent: saved.required_count
            ? Math.round((saved.completed_count / saved.required_count) * 100)
            : 0,
          count_label: `已评 ${saved.completed_count} / ${saved.required_count} 题`,
        },
      });
      this.recount();
    } catch (err) {
      this.setData({ saving: '' });
      this.patchItem(code, {
        score: before.score,
        scored: before.scored,
        evidence_expected: before.evidence_expected,
      });
      reportFailure(this, err, {});
    }
  },

  /** 在两份数组里找同一道题：`sections` 是全量，`visibleSections` 是当前筛选下的。 */
  findItem(code) {
    for (const s of this.data.sections) {
      const hit = s.items.find((i) => i.code === code);
      if (hit) return hit;
    }
    return null;
  },

  /** 改一道题，两份数组一起改 —— 只改一份会让筛选切换时把改动丢掉。 */
  patchItem(code, patch) {
    const apply = (list) => list.map((s) => ({
      ...s,
      items: s.items.map((i) => (i.code === code ? { ...i, ...patch } : i)),
    }));
    this.setData({
      sections: apply(this.data.sections),
      visibleSections: apply(this.data.visibleSections),
    });
  },

  /** 各张一级指标卡右上角的「已评/总数」。打完一个分要跟着动。 */
  recount() {
    const sections = this.data.sections.map((s) => {
      const done = s.items.filter((i) => i.scored).length;
      return { ...s, done, meta: `${done}/${s.total}`, complete: done === s.total };
    });
    this.setData({ sections });
    this.applyFilter();
  },
});
