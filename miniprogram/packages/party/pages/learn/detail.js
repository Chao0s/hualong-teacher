/**
 * 资料详情页 — APP-STRUCTURE.md screen id `LearnDetail`.
 *
 * Read-only. §2.3: a study outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 */

const guard = require('../../../../utils/guard');
const party = require('../../../../services/party');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    study: null,
    studyId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const studyId = Number(query.study_id);
    if (!studyId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少资料编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, studyId });
    this.load(studyId);
  },

  onRetryLoad() {
    if (!this.data.studyId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.studyId);
  },

  async load(studyId) {
    try {
      const row = await party.studyDetail(studyId);
      this.setData({ study: row, loading: false });
      if (row.study_title) {
        wx.setNavigationBarTitle({ title: row.study_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 外部影片只复制，不内嵌播放（F7）。反馈由服务层统一给。 */
  onCopyLink(e) {
    party.copyVideoLink(e.currentTarget.dataset.url);
  },
});
