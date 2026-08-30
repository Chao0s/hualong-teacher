/** 教师评价 —— 原型 screens/teacher-evaluation.html 的小程序版本。 */

const ROUTES = {
  monthly: '/pages/teacher-monthly-evaluation/index',
  term: '/pages/teacher-term-evaluation/index',
  comprehensive: '/pages/growth-comprehensive-assessment/index',
  message: '/pages/teacher-message/index',
};

Page({
  data: {
    entries: [
      { key: 'monthly', label: '月度评价', primary: true },
      { key: 'term', label: '学期评价' },
      { key: 'comprehensive', label: '综合评估' },
      { key: 'message', label: '教师寄语' },
    ],

    // 四列：本月评价 / 学期评估 / 综合评估 / 教师寄语
    rows: [
      { name: '陈小明', states: ['done', 'done', 'done', 'done'] },
      { name: '李雨萱', states: ['done', 'miss', 'miss', 'miss'] },
      { name: '张力轩', states: ['miss', 'miss', 'miss', 'miss'] },
      { name: '王子涵', states: ['done', 'done', 'done', 'miss'] },
      { name: '赵佳怡', states: ['miss', 'miss', 'done', 'miss'] },
      { name: '刘浩然', states: ['done', 'done', 'done', 'done'] },
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
