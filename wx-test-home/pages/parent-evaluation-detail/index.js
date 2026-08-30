/** 家长测评进度 —— 原型 screens/parent-evaluation-detail.html 的小程序版本。 */

Page({
  data: {
    rate: 82,
    metrics: [
      { value: '28', label: '需提交' },
      { value: '25', label: '已读' },
      { value: '23', label: '已提交' },
    ],

    rows: [
      { name: '陈小明', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '能主动整理玩具' },
      { name: '李雨萱', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '愿意讲述绘本' },
      { name: '张力轩', read: { state: 'read', text: '已读' }, done: { state: 'wait', text: '未提交' }, preview: '—' },
      { name: '王子涵', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '户外活动更积极' },
      { name: '赵佳怡', read: { state: 'miss', text: '未读' }, done: { state: 'miss', text: '未完成' }, preview: '' },
      { name: '刘浩然', read: { state: 'read', text: '已读' }, done: { state: 'done', text: '已完成' }, preview: '开始独立穿衣' },
    ],
  },
});
