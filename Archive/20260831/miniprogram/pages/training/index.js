/**
 * 教研培训入口页 — APP-STRUCTURE.md screen id `TrainHome`.
 *
 * A bottom-bar destination. The tab needed somewhere to land, so this screen
 * carries `notInFlowchart` in the structure contract: it is not a Mermaid node.
 *
 * 版面按原型 training-center.html（园方 2026-08-26 裁定以原型为准）：顶部推荐轮播、
 * 三张快捷入口卡、推荐资源与推荐案例两节。三块动态内容一次读回 `GET /training/home`
 * ——那条聚合端点是本轮新接的，契约里没有它（缺口已登记）。
 *
 * Thin by the ticket-08 template: it calls the service, setData, and answers
 * taps. 卡片表、去向、门与文案都在 services/training.js。
 */

const guard = require('../../utils/guard');
const training = require('../../services/training');
const library = require('../../services/library');
const { reportFailure } = require('../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    featured: [],
    resources: [],
    cases: [],
    quickEntries: training.quickEntries(),
    // 当前是第几张轮播。指示点自己画，所以这个下标要留在数据里。
    slide: 0,
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
      const view = await training.trainingHome();
      this.setData({ ...view, slide: 0, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  onSlideChange(e) {
    this.setData({ slide: e.detail.current });
  },

  /** 轮播卡可以是资源也可以是案例，所以类型与 id 一起带过来。 */
  onFeaturedTap(e) {
    const { type, id } = e.currentTarget.dataset;
    training.openFeatured(type, id);
  },

  onQuickTap(e) {
    training.openQuickEntry(e.currentTarget.dataset.key);
  },

  onResourceTap(e) {
    library.openResource(e.currentTarget.dataset.id);
  },

  onCaseTap(e) {
    library.openCase(e.currentTarget.dataset.id);
  },

  /** 两节的「全部」各进各的列表页。 */
  onMoreTap(e) {
    library.open(e.currentTarget.dataset.key);
  },
});
