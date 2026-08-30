/**
 * 课程资源 —— 原型 screens/resource-center.html 的小程序版本。
 *
 * 原型的搜索表单提交后跳 `resource-library.html?q=...`；这里跳同名页面，
 * 参数照传，资源库页在 onLoad 里读它。
 */

Page({
  data: {
    query: '',

    hubs: [
      { key: 'resource', title: '课程资源库', desc: '按衣食住行艺进入主题资源' },
      { key: 'case', title: '课程案例库', desc: '按年级、领域、活动类型筛选' },
    ],

    resources: [
      {
        icon: 'house', tone: 'accent', name: '沙湾留耕堂 · 何氏宗祠', badge: '住',
        meta: '传统建筑 · 大班可转化 · 关联 2 个案例',
        summary: '从祠堂空间、宗族故事与家庭团聚经验进入，帮助幼儿理解家庭与社区的情感纽带。',
      },
      {
        icon: 'star', tone: 'green', name: '沙湾砖雕 · 岭南纹样', badge: '艺',
        meta: '民间艺术 · 中大班 · 关联 3 个案例',
        summary: '观察砖雕纹样的线条与对称结构，转化为拓印、线描与积木建构活动。',
      },
    ],

    cases: [
      {
        icon: 'book', tone: 'accent', name: '祠堂里的故事', badge: '大班',
        meta: '社会 · 住 · 留耕堂资源转化',
        summary: '观察祠堂实景、聆听绘本故事、分享家庭团聚经历，再合作搭建祠堂模型。',
      },
      {
        icon: 'wave', tone: 'amber', name: '龙舟竞渡', badge: '大班',
        meta: '健康 · 行 · 集体教学',
        summary: '把龙舟节奏、协作和身体动作经验转化为合作运动游戏。',
      },
    ],
  },

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
  },

  onSearch() {
    const query = this.data.query.trim();
    if (!query) return;
    wx.navigateTo({ url: `/pages/resource-library/index?q=${encodeURIComponent(query)}` });
  },

  onHubTap(e) {
    const key = e.currentTarget.dataset.key;
    wx.navigateTo({
      url: key === 'resource' ? '/pages/resource-library/index' : '/pages/case-library/index',
    });
  },

  onResourceTap() {
    wx.navigateTo({ url: '/pages/resource-detail/index' });
  },

  onResourceMore() {
    wx.navigateTo({ url: '/pages/resource-library/index' });
  },

  onCaseTap() {
    wx.navigateTo({ url: '/pages/case-detail/index' });
  },

  onCaseMore() {
    wx.navigateTo({ url: '/pages/case-library/index' });
  },
});
