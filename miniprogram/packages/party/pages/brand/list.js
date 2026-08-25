/**
 * 品牌建设资料列表页 — APP-STRUCTURE.md screen id `BrandList`.
 *
 * Thin by the ticket-08 template, identical in shape to the study and activity
 * lists: one service call, one set of shared list methods, no endpoint and no
 * formatting here.
 */

const guard = require('../../../../utils/guard');
const party = require('../../../../services/party');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /** Reaching the bottom is the only way more rows arrive. */
  onReachBottom() {
    this.loadMore();
  },

  ...createListMethods({ fetchPage: party.listBrands }),

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/brand/detail?brand_id=${id}` });
  },
});
