/**
 * 党建活动 · 全部活动 —— 数据来自 `GET /party/activities`。
 *
 * 原型把 5 场活动写死在这里；已经删掉。列表行的「日期 · 地点」两段元信息在服务层
 * 拼好（`db_party_activity` 的 activity_at／activity_location）。
 *
 * 教师只读得到已发布（`s3`）的活动；待审核的由服务端挡在范围外。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

Page({
  data: {
    activities: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await party.listActivities({ limit: PAGE_LIMIT });
      this.setData({ activities: page.items, nextCursor: page.nextCursor, loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        activities: [],
        error: err.userMessage || '党建活动加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（契约 §3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await party.listActivities({ cursor: this.data.nextCursor, limit: PAGE_LIMIT });
      this.setData({
        activities: this.data.activities.concat(page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (err) {
      this.setData({ loadingMore: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '加载更多失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/party-activity-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
