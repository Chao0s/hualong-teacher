/** 亲子任务 —— 原型 screens/parent-tasks.html 的小程序版本。 */

Page({
  data: {
    tasks: [
      { glyph: '社', tone: 'green', title: '寻找社区里的老建筑', typeLabel: '社区', community: true, meta: '6月8日发布 · 28 人中 23 人完成' },
      { glyph: '日', tone: '', title: '和家人一起做端午香囊', typeLabel: '日常', meta: '6月1日发布 · 28 人中 26 人完成' },
      { glyph: '社', tone: 'amber', title: '周末观察社区榕树', typeLabel: '社区', community: true, meta: '5月25日发布 · 28 人中 21 人完成' },
      { glyph: '日', tone: 'blue', title: '亲子阅读：我的一天', typeLabel: '日常', meta: '5月18日发布 · 28 人中 28 人完成' },
    ],
  },

  onPublish() {
    wx.navigateTo({ url: '/pages/parent-task-publish/index' });
  },

  onTaskTap() {
    wx.navigateTo({ url: '/pages/parent-task-detail/index' });
  },
});
