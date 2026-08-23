/**
 * 通知详情页 — APP-STRUCTURE.md screen id `NoticeDetail`.
 *
 * Read-only. §2.3: a notice outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither.
 */

const api = require('../../utils/request');
const guard = require('../../utils/guard');
const time = require('../../utils/time');
const identity = require('../../services/identity');
const { present } = require('../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    notice: null,
    noticeId: 0,
    publishedLabel: '',
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const noticeId = Number(query.notice_id);
    if (!noticeId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少通知编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, noticeId });
    this.load(noticeId);
  },

  onRetryLoad() {
    if (!this.data.noticeId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.noticeId);
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
      if (identity.handleAuthFailure(err)) return;
      const failure = present(err);
      this.setData({
        loading: false,
        errorText: failure.message,
        errorRequestId: failure.requestId,
        errorCanRetry: failure.canRetry,
      });
    }
  },
});
