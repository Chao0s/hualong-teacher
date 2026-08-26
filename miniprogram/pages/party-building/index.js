/**
 * 党建管理入口页 — APP-STRUCTURE.md screen id `PartyHome`.
 *
 * A bottom-bar destination. The tab needed somewhere to land, so this screen
 * carries `notInFlowchart` in the structure contract: it is not a Mermaid node.
 *
 * 这一页从「三条整宽链接」改成原型 school-affairs.html 的形状（轮播＋三个分区），
 * 同时接上 `GET /party/home` —— 那条聚合端点此前从未被调用过。三个分区的「全部 ›」
 * 仍然走 services/module-entry.js：入口的去向、顺序与拒绝文案只有那一处声明，
 * 这一页不重复一份路由表。
 *
 * Thin by the ticket-08 template: it calls the service, setData, and answers
 * taps. It holds no endpoint path, no enum table and no time format — 标签与
 * 时间文案都在 services/party.js 里算好了。
 */

const guard = require('../../utils/guard');
const party = require('../../services/party');
const moduleEntry = require('../../services/module-entry');
const { reportFailure } = require('../../utils/present');

const MODULE_ID = 'party-building';

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    carousel: [],
    studies: [],
    activities: [],
    brands: [],
    // 当前是第几张轮播。指示点自己画，所以这个下标要留在数据里。
    slide: 0,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.load();
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const view = await party.partyHome();
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

  /** 轮播与学习资料卡都进同一个详情页。 */
  onStudyTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/learn/detail?study_id=${id}` });
  },

  onActivityTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/activity/detail?activity_id=${id}` });
  },

  onBrandTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/brand/detail?brand_id=${id}` });
  },

  // 预览与下载是同一条契约能力的两个入口，差别只有一个布尔值。
  // 两个都把 promise 交回去：取档是异步的，调用方（包括测试）要等得到它。
  onPreviewTap(e) {
    return party.openStudyFile(e.currentTarget.dataset.id, false);
  },

  onDownloadTap(e) {
    return party.openStudyFile(e.currentTarget.dataset.id, true);
  },

  /** 分区标题右侧的「全部 ›」。去向由 module-entry 决定，含角色门与拒绝文案。 */
  onEntryTap(e) {
    moduleEntry.openEntry(MODULE_ID, e.currentTarget.dataset.key);
  },
});
