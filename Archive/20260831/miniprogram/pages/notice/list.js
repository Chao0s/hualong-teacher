/**
 * 通知列表页 — APP-STRUCTURE.md screen id `NoticeList`.
 *
 * The first cursor-paginated list, and since ticket 07 a thin consumer of the
 * shared list conventions in utils/list-page.js — pagination, the three list
 * states, self-heal and failure presentation all live there, once.
 *
 * Since ticket 08 the rows themselves come from services/notice.js, so this
 * file names no endpoint and formats nothing.
 */

const guard = require('../../utils/guard');
const notice = require('../../services/notice');
const { createListMethods } = require('../../utils/list-page');

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

  // The rows come from the notice service — the same call 首页's notice region
  // makes, so the two cannot disagree about shape or ordering (ticket 08).
  ...createListMethods({ fetchPage: notice.listPage }),

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/notice/detail?notice_id=${id}` });
  },
});
