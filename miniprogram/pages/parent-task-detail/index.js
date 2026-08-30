/** 亲子任务 · 任务详情 —— 原型 screens/parent-task-detail.html 的小程序版本。 */

Page({
  data: {
    rate: 82,
    metrics: [
      { value: '28', label: '班级人数' },
      { value: '26', label: '已读' },
      { value: '23', label: '已完成' },
    ],

    rows: [
      { name: '陈小明', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '祠堂门口合影' },
      { name: '李雨萱', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '老街牌匾照片' },
      { name: '张力轩', read: { state: 'read', text: '已读' }, done: { state: 'wait', text: '未提交' }, preview: '—' },
      { name: '王子涵', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '祖屋窗花记录' },
      { name: '赵佳怡', read: { state: 'miss', text: '未读' }, done: { state: 'miss', text: '未完成' }, preview: '' },
      { name: '刘浩然', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '村口石碑讲述' },
      { name: '周睿阳', read: { state: 'miss', text: '未读' }, done: { state: 'miss', text: '未完成' }, preview: '' },
    ],
  },
});
