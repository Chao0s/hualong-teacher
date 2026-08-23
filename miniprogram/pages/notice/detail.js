/**
 * 通知详情页 — APP-STRUCTURE.md screen id `NoticeDetail`.
 *
 * Read-only. §2.3: a notice outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither.
 */

const api = require('../../utils/request');
const guard = require('../../utils/guard');
const session = require('../../utils/session');
const time = require('../../utils/time');
const { ApiError } = require('../../utils/errors');

Page({
  data: {
    ready: false,
    loading: true,
    notice: null,
    publishedLabel: '',
    errorText: '',
    errorRequestId: '',
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const noticeId = Number(query.notice_id);
    if (!noticeId) {
      this.setData({ ready: true, loading: false, errorText: '缺少通知编号' });
      return;
    }
    this.setData({ ready: true });
    this.load(noticeId);
  },

  async load(noticeId) {
    try {
      // §2.1: a single resource sits at the top level. No {code, data} wrapper
      // to unpick.
      const notice = await api.get(`/notices/${noticeId}`);
      this.setData({
        notice,
        publishedLabel: time.formatLong(notice.published_at),
        loading: false,
      });
      if (notice.notice_title) {
        wx.setNavigationBarTitle({ title: notice.notice_title });
      }
    } catch (err) {
      if (err instanceof ApiError && err.isAuthFailure) {
        session.clear();
        guard.redirectToLogin();
        return;
      }
      this.setData({
        loading: false,
        errorText: err instanceof ApiError ? err.userMessage : '加载失败',
        errorRequestId: err instanceof ApiError ? (err.requestId || '') : '',
      });
    }
  },
});
