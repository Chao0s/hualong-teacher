/**
 * 教研培训部 —— 原型 screens/training-center.html 的小程序版本。
 *
 * 三块内容：轮播头图、快捷入口、推荐资源/案例。文案全部搬进 data，
 * 由 wxml 的 wx:for 展开，对应原型里写死的那几段 HTML。
 */

const TARGETS = {
  'course-building': '/pages/course-building/index',
  'resource-center': '/pages/resource-center/index',
  'training-list': '/pages/training-list/index',
};

Page({
  data: {
    bannerIndex: 0,
    banners: [
      {
        tone: 'b1',
        kicker: '推荐资源 · 社会',
        title: '沙湾留耕堂 · 祠堂空间',
        desc: '以祠堂空间、家族故事和家乡记忆为线索，支持社会领域主题活动转化。',
      },
      {
        tone: 'b2',
        kicker: '推荐案例 · 健康',
        title: '龙舟竞渡',
        desc: '把龙舟节奏、协作和身体动作经验转化为集体运动游戏。',
      },
      {
        tone: 'b3',
        kicker: '推荐资源 · 艺术',
        title: '沙湾砖雕 · 岭南纹样',
        desc: '观察砖雕纹样中的线条、对称和浮雕层次，转化为拓印、线描与建构活动。',
      },
    ],

    entries: [
      { key: 'course-building', glyph: '建', title: '课程建设', desc: '课程体系沉淀', tone: 'accent' },
      { key: 'resource-center', glyph: '资', title: '课程资源', desc: '资源库、案例库', tone: 'blue' },
      { key: 'training-list', glyph: '训', title: '教研培训', desc: '研修与反馈', tone: 'green' },
    ],

    resources: [
      {
        glyph: '乡', tone: 'accent', name: '沙湾留耕堂 · 祠堂空间', badge: '社会',
        meta: '传统建筑 · 大班 · 关联 2 个案例',
        summary: '以祠堂空间、家族故事和家乡记忆为线索，支持社会领域主题活动转化。',
      },
      {
        glyph: '艺', tone: 'green', name: '沙湾砖雕 · 岭南纹样', badge: '艺术',
        meta: '民间艺术 · 中大班 · 关联 3 个案例',
        summary: '观察砖雕纹样中的线条、对称和浮雕层次，转化为拓印、线描与建构活动。',
      },
      {
        glyph: '科', tone: 'blue', name: '岭南植物角 · 种子发芽', badge: '科学',
        meta: '自然观察 · 小中班 · 关联 1 个案例',
        summary: '记录种子发芽、测量高度和照料变化，形成连续观察材料。',
      },
    ],

    cases: [
      {
        glyph: '社', tone: 'accent', name: '祠堂里的故事', badge: '大班',
        meta: '社会 · 住 · 留耕堂资源转化',
        summary: '观察祠堂实景、聆听家乡故事、分享家庭团聚经历，再合作搭建祠堂模型。',
      },
      {
        glyph: '健', tone: 'amber', name: '龙舟竞渡', badge: '大班',
        meta: '健康 · 行 · 集体教学',
        summary: '把龙舟节奏、协作和身体动作经验转化为合作运动游戏。',
      },
      {
        glyph: '语', tone: 'green', name: '醒狮从哪里来', badge: '中班',
        meta: '语言 · 艺 · 图文讲述',
        summary: '围绕醒狮图片和视频片段进行讲述、排序和角色表达。',
      },
    ],
  },

  onBannerChange(e) {
    this.setData({ bannerIndex: e.detail.current });
  },

  onEntryTap(e) {
    wx.navigateTo({ url: TARGETS[e.currentTarget.dataset.key] });
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
