/**
 * 通知详情页 — APP-STRUCTURE.md screen id `NoticeDetail`.
 *
 * Read-only. §2.3: a notice outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That single wording comes from the
 * error registry through reportFailure; nothing here composes it.
 */

const guard = require('../../utils/guard');
const notice = require('../../services/notice');
const { reportFailure } = require('../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    notice: null,
    noticeId: 0,
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
      const row = await notice.detail(noticeId);
      this.setData({ notice: row, loading: false });
      if (row.notice_title) {
        wx.setNavigationBarTitle({ title: row.notice_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },
});
