/**
 * 学习资料列表页 — APP-STRUCTURE.md screen id `LearnList`.
 *
 * The first page to live in a subpackage. It sits under `packages/party`, which
 * maps to services/party.js and to nothing else — the boundary ticket 12 asks
 * for, and the one `npm run verify:build` now checks.
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/party.js, so this file names no endpoint and formats nothing.
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

  ...createListMethods({ fetchPage: party.listStudies }),

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/learn/detail?study_id=${id}` });
  },
});
