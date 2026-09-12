/** 家园社共育 —— 本班三项进度，状态与汇总由后端实时派生。 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

const ROUTES = {
  moments: '/pages/home-school-moments/index',
  tasks: '/pages/parent-tasks/index',
  record: '/pages/growth-record/index',
  community: '/pages/community-coeducation/index',
};

Page({
  data: {
    entries: [
      { key: 'moments', glyph: '时光', label: '在园时光' },
      { key: 'tasks', glyph: '任务', label: '亲子任务' },
      { key: 'record', glyph: '档案', label: '成长档案' },
      { key: 'community', glyph: '社区', label: '社区共育' },
    ],

    metrics: [],
    rows: [],
    loading: true,
    error: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    const seq = (this.loadSeq || 0) + 1;
    this.loadSeq = seq;
    // 失败时不保留旧班级的数字，也不把读取失败画成全班未完成。
    this.setData({ loading: true, error: '', metrics: [], rows: [] });
    try {
      await guard.requireSession();
      const board = await co.homeSchoolProgress();
      if (seq !== this.loadSeq) return;
      this.setData({ ...board, loading: false });
    } catch (err) {
      if (seq !== this.loadSeq) return;
      guard.endSessionOnAuthFailure(err);
      this.setData({ loading: false, error: err.userMessage || err.message || '进度加载失败，请重试' });
    }
  },

  onRetry() {
    this.load();
  },

  onEntryTap(e) {
    const key = e.currentTarget.dataset.key;
    const url = ROUTES[key];
    if (url) {
      wx.navigateTo({ url });
      return;
    }
    const hit = this.data.entries.find((item) => item.key === key);
    wx.showToast({ title: `${hit.label}（预览工程未接入）`, icon: 'none' });
  },
});
