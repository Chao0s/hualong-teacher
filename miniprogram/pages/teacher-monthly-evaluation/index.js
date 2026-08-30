/** 教师月度评价 —— 原型 screens/teacher-monthly-evaluation.html 的小程序版本。 */

Page({
  data: {
    months: [3, 4, 5, 6],
    rows: [
      { child: 'chen', name: '陈小明', states: ['done', 'done', 'done', 'done'] },
      { child: 'li', name: '李雨萱', states: ['done', 'done', 'miss', 'miss'] },
      { child: 'zhang', name: '张力轩', states: ['done', 'miss', 'miss', 'miss'] },
      { child: 'wang', name: '王子涵', states: ['done', 'done', 'done', 'done'] },
      { child: 'zhao', name: '赵佳怡', states: ['miss', 'miss', 'miss', 'miss'] },
      { child: 'liu', name: '刘浩然', states: ['done', 'done', 'done', 'done'] },
    ],
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/teacher-monthly-form/index' });
  },

  /** 已完成的带 view=1 进只读查看，未完成的直接进填写，和原型的链接一致。 */
  onDotTap(e) {
    const { child, month, done } = e.currentTarget.dataset;
    const view = done ? '&view=1' : '';
    wx.navigateTo({ url: `/pages/teacher-monthly-form/index?child=${child}&month=${month}${view}` });
  },
});
