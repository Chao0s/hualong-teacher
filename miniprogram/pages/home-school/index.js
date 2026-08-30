/** 家园社共育 —— 原型 screens/home-school.html 的小程序版本。 */

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

    metrics: [
      { value: '28', label: '班级幼儿' },
      { value: '84%', label: '平均完成' },
      { value: '6', label: '待提醒', amber: true },
    ],

    rows: [
      { name: '陈小明', cells: [{ state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'done', text: '已定稿' }] },
      { name: '李雨萱', cells: [{ state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'wait', text: '进行中' }, { state: 'miss', text: '未定稿' }] },
      { name: '张力轩', cells: [{ state: 'done', text: '已完成' }, { state: 'miss', text: '未提交' }, { state: 'wait', text: '进行中' }, { state: 'miss', text: '未定稿' }] },
      { name: '王子涵', cells: [{ state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'done', text: '已定稿' }] },
      { name: '赵佳怡', cells: [{ state: 'miss', text: '缺第2次' }, { state: 'miss', text: '未提交' }, { state: 'done', text: '已完成' }, { state: 'miss', text: '未定稿' }] },
      { name: '刘浩然', cells: [{ state: 'done', text: '已完成' }, { state: 'done', text: '已完成' }, { state: 'wait', text: '进行中' }, { state: 'miss', text: '未定稿' }] },
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
