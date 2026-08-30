/**
 * 党建活动列表页 — APP-STRUCTURE.md screen id `ActivityList`.
 *
 * Thin by the ticket-08 template, exactly as the study list is: pagination, the
 * three list states, self-heal and failure presentation come from
 * utils/list-page.js, and the rows come from services/party.js, so this file
 * names no endpoint and formats nothing — including the activity time, which
 * §1.2 forbids anyone here to touch.
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

  ...createListMethods({ fetchPage: party.listActivities }),

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/party/pages/activity/detail?activity_id=${id}` });
  },
});
