/**
 * 社区共育 — APP-STRUCTURE.md screen id `CommunityCoedu`（2026-08-26 收录）。
 *
 * 原型 community-coeducation.html：两个筛选加一条家长提交的动态流。
 *
 * ── 这一页读的是什么 ────────────────────────────────────────────────────────
 *
 * DECISIONS B11／E5 拔掉了 `db_community_submission`：**没有第二张提交表**。这一页读
 * 的是已发布亲子任务（t1 日常｜t2 社区）加它们的家长提交行，按任务类型筛。所以
 * 「社区共育」不是一个独立的内容源，它是亲子任务的一个视角。
 *
 * ── 把关 ────────────────────────────────────────────────────────────────────
 *
 * 流上每一条都是**家长内容**，在家长提交的那一刻就走过了 ADR-0016 第三行的批式把关。
 * 这一页是读面，不再把一次关；仍在批次里的那些服务端根本不给。所以本页没有
 * `assertGate` —— 它一个字也不著作。
 *
 * ── 原型那个「加入成长册」 ──────────────────────────────────────────────────
 *
 * 原型每条卡片右下角有一枚「＋ 加入成长册」，写的是 `db_growth_material`。**本轮不建**：
 * 成长册的资料通道在 `packages/growth-book` 分包，而分包规则不许本分包的页面 require
 * 第二个服务模块；把它挪进来要动成长册那条链的边界，是另一件事。按项目惯例，
 * 缺席的能力不做成一个会失败的按钮 —— 这里索性不画它，缺口记进交接。
 */

const guard = require('../../../../utils/guard');
const coEducation = require('../../../../services/co-education');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    filters: coEducation.COMMUNITY_FILTERS.map((f) => ({ key: f.value, label: f.label })),
    filterValue: 'all',
    items: [],
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
      const items = await coEducation.communityFeed({ parent_task_type: this.data.filterValue });
      this.setData({ items, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  /**
   * 换筛选就是换一组内容：先清空再重读。
   *
   * 先清空是有用的：读失败时会保留原有的条目，那些条目属于上一个筛选，留在新标签下
   * 就是在骗人（与综合协调的类目标签同一条判断）。
   */
  onFilterTap(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.filterValue) return;
    this.setData({ filterValue: key, items: [] });
    return this.load();
  },

  /** 点一条进它那次亲子任务的完成进度 —— 那一页才是这条提交的上下文。 */
  onItemTap(e) {
    coEducation.openTaskProgress(e.currentTarget.dataset.id);
  },
});
