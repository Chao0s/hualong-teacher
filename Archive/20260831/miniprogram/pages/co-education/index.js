/**
 * 家园社共育入口页 — APP-STRUCTURE.md screen id `CoEduHome`.
 *
 * A bottom-bar destination. The tab needed somewhere to land, so this screen
 * carries `notInFlowchart` in the structure contract: it is not a Mermaid node.
 *
 * 版面按原型 home-school.html（园方 2026-08-26 裁定以原型为准）：渐变头图、四张快捷
 * 入口卡、完成度汇总（三个数字加一张逐儿四列的表）。数据一次读回
 * `GET /home-school/home` —— 那条聚合端点是本轮新接的，契约里没有它（缺口已登记）。
 *
 * **这一页 require 两个服务模块**，与其他页面不同：四张卡里「成长档案」的落点在
 * `packages/evaluation` 分包，那个分包的路径由 services/evaluation.js 说了算。分包
 * 边界的规则约束的是分包内的文件，这一页在主包，所以它可以同时问两边 —— 让它自己
 * 抄一份路径才是错的。
 */

const guard = require('../../utils/guard');
const coEducation = require('../../services/co-education');
const evaluation = require('../../services/evaluation');
const identity = require('../../services/identity');
const { reportFailure } = require('../../utils/present');

/**
 * 原型那四张卡。前两张与后两张分属两个分包，所以去向各问各的服务模块。
 *
 * 原型的第四张是「社区共育」，它在结构契约里此前没有页面 —— 2026-08-26 连同成长档案
 * 这条链一起收录（45 -> 52），所以四张卡现在都有落点。
 */
const QUICK_ENTRIES = [
  { key: 'moment', mark: '时光', label: '在园时光', tint: 'accent' },
  { key: 'task', mark: '任务', label: '亲子任务', tint: 'green' },
  { key: 'record', mark: '档案', label: '成长档案', tint: 'amber' },
  { key: 'community', mark: '社区', label: '社区共育', tint: 'blue' },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    className: '',
    quickEntries: QUICK_ENTRIES,
    columns: coEducation.HOME_COLUMNS,
    metrics: [],
    rows: [],
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, className: identity.homeIdentity().className });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const view = await coEducation.homeSchoolHome();
      this.setData({
        metrics: view.metrics,
        rows: view.rows,
        // 班级名以聚合返回的为准：它与表里的幼儿出自同一次读取，不会各说各的。
        className: view.className || this.data.className,
        loading: false,
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  onQuickTap(e) {
    switch (e.currentTarget.dataset.key) {
      case 'moment': return coEducation.openMomentProgress();
      case 'task': return coEducation.openTaskPublish();
      case 'record': return evaluation.openGrowthRecord();
      case 'community': return coEducation.openCommunity();
      default: return undefined;
    }
  },
});
