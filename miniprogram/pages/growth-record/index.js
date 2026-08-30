/**
 * 儿童成长档案 —— 原型 screens/growth-record.html 的小程序版本。
 *
 * 进度表六列的次序：家长月度 / 家长学期 / 教师月度 / 教师学期 / 综合 / 成长册。
 * 原型里每格是一个 font-size:0 的 span 加一个 ::before 圆点，实际只看得到圆点，
 * 所以这里直接画圆点，不再放那段看不见的文字。
 */

const ROUTES = {
  'parent-eval': '/pages/parent-evaluation-publish/index',
  'teacher-eval': '/pages/teacher-evaluation/index',
  book: '/pages/growth-book/index',
};

Page({
  data: {
    entries: [
      { key: 'parent-eval', label: '发布家长评价', primary: true },
      { key: 'teacher-eval', label: '教师评价' },
      { key: 'book', label: '成长册' },
    ],

    rows: [
      { name: '陈小明', states: ['done', 'done', 'done', 'miss', 'done', 'miss'] },
      { name: '李雨萱', states: ['done', 'miss', 'miss', 'miss', 'miss', 'miss'] },
      { name: '张力轩', states: ['miss', 'miss', 'miss', 'miss', 'miss', 'miss'] },
      { name: '王子涵', states: ['done', 'done', 'done', 'done', 'done', 'miss'] },
      { name: '赵佳怡', states: ['miss', 'miss', 'miss', 'miss', 'done', 'miss'] },
      { name: '刘浩然', states: ['done', 'done', 'done', 'done', 'done', 'done'] },
    ],
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
