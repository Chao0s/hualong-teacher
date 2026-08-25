/**
 * 活动介绍页 — APP-STRUCTURE.md screen id `ActivityDetail`.
 *
 * Read-only. §2.3: an activity outside the caller's scope comes back as 404,
 * not 403 — scope is hidden rather than confirmed, so this page treats "gone"
 * and "not yours" identically and says neither.
 */

const guard = require('../../../../utils/guard');
const party = require('../../../../services/party');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    activity: null,
    activityId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const activityId = Number(query.activity_id);
    if (!activityId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少活动编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, activityId });
    this.load(activityId);
  },

  onRetryLoad() {
    if (!this.data.activityId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.activityId);
  },

  async load(activityId) {
    try {
      const row = await party.activityDetail(activityId);
      this.setData({ activity: row, loading: false });
      if (row.activity_title) {
        wx.setNavigationBarTitle({ title: row.activity_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },
});
