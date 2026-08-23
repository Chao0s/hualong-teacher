/**
 * 通知列表页 — APP-STRUCTURE.md screen id `NoticeList`.
 *
 * This page exists mainly to exercise cursor pagination end to end (§3.1—§3.3):
 * an opaque cursor, no `offset`, no `page`, no `total`, and a `null` cursor as
 * the only end-of-list signal. Everything downstream that reads a time stream
 * copies this shape.
 */

const api = require('../../utils/request');
const guard = require('../../utils/guard');
const session = require('../../utils/session');
const time = require('../../utils/time');
const { ApiError } = require('../../utils/errors');

Page({
  data: {
    ready: false,
    items: [],
    cursor: null,
    // Distinguishes "first load" from "appending", so the spinner does not
    // replace a list the user is already reading.
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
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

  async loadFirst() {
    this.setData({
      loadingFirst: true,
      errorText: '',
      errorRequestId: '',
      // Drop the old cursor with the old list. §3.3: a cursor is bound to its
      // filter set, and reusing one across a reload is how you get
      // `400 cursor_filter_mismatch`.
      cursor: null,
      exhausted: false,
    });
    try {
      const { items, nextCursor } = await api.getPage('/notices');
      this.setData({
        items: items.map(decorate),
        cursor: nextCursor,
        exhausted: nextCursor === null,
        loadingFirst: false,
      });
    } catch (err) {
      this.reportError(err, { loadingFirst: false });
    }
  },

  async loadMore() {
    if (this.data.loadingMore || this.data.exhausted || this.data.loadingFirst) return;
    if (!this.data.cursor) {
      this.setData({ exhausted: true });
      return;
    }
    this.setData({ loadingMore: true, errorText: '' });
    try {
      const { items, nextCursor } = await api.getPage('/notices', { cursor: this.data.cursor });
      this.setData({
        items: this.data.items.concat(items.map(decorate)),
        cursor: nextCursor,
        exhausted: nextCursor === null,
        loadingMore: false,
      });
    } catch (err) {
      // A stale or filter-mismatched cursor is recoverable exactly once: reload
      // from the top rather than leaving the user on a list that cannot grow.
      if (err instanceof ApiError
        && (err.code === 'cursor_invalid' || err.code === 'cursor_filter_mismatch')) {
        this.setData({ loadingMore: false });
        this.loadFirst();
        return;
      }
      this.reportError(err, { loadingMore: false });
    }
  },

  reportError(err, extra = {}) {
    if (err instanceof ApiError && err.isAuthFailure) {
      session.clear();
      guard.redirectToLogin();
      return;
    }
    this.setData({
      ...extra,
      errorText: err instanceof ApiError ? err.userMessage : '加载失败，请下拉重试',
      errorRequestId: err instanceof ApiError ? (err.requestId || '') : '',
    });
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/notice/detail?notice_id=${id}` });
  },
});

function decorate(notice) {
  return {
    ...notice,
    published_label: time.formatShort(notice.published_at),
  };
}
