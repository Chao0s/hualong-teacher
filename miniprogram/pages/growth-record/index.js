/**
 * 儿童成长档案 —— 接 `GET /growth-records`（services/assessment.js）。
 *
 * 进度表**五列**：家长月度 / 家长学期 / 教师月度 / 教师学期 / 综合。
 * 原型第六列「成长册」去掉了 —— 全库没有数据源，列由 service 的 `GROWTH_COLUMNS` 给。
 *
 * 原型里每格是一个 font-size:0 的 span 加一个 ::before 圆点，实际只看得到圆点，
 * 所以这里直接画圆点，不再放那段看不见的文字。
 */

const assess = require('../../services/assessment.js');

const ROUTES = {
  'parent-eval': '/pages/parent-evaluation-publish/index',
  'teacher-eval': '/pages/teacher-evaluation/index',
  book: '/pages/growth-book/index',
};

Page({
  data: {
    entries: [
      { key: 'parent-eval', label: '发布家长评价' },
      { key: 'teacher-eval', label: '教师评价' },
      { key: 'book', label: '成长册' },
    ],

    columns: [],
    rows: [],
  },

  /** 从三个入口页返回时要重新取：那几页会改齐备度。 */
  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const board = await assess.growthRecordBoard();
      this.setData({ columns: board.columns, rows: board.rows });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '进度加载失败，请下拉重试', icon: 'none' });
    }
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
