/**
 * 教研培训部 —— 原型 screens/training-center.html 的小程序版本。
 *
 * 三块内容：轮播头图、快捷入口、推荐资源/案例。文案全部搬进 data，
 * 由 wxml 的 wx:for 展开，对应原型里写死的那几段 HTML。
 */

const training = require('../../services/training');
const guard = require('../../utils/guard');

const TARGETS = {
  'course-building': '/pages/course-building/index',
  'resource-center': '/pages/resource-center/index',
  'training-list': '/pages/training-list/index',
};

Page({
  data: {
    bannerIndex: 0,

    // 三块都从 `GET /training/home` 来（G111）。**初值是空数组，不是写死的卡片** ——
    // 写死的话接口挂了屏幕上照样是三张像真的卡，那比空白更难发现。
    banners: [],
    resources: [],
    cases: [],

    loading: true,
    error: '',

    // 入口是**导航**、没有数据源，所以留字面量（§8：没有数据源就不要渲染它）。
    entries: [
      { key: 'course-building', glyph: '建', title: '课程建设', desc: '课程体系沉淀', tone: 'accent' },
      { key: 'resource-center', glyph: '资', title: '课程资源', desc: '资源库、案例库', tone: 'blue' },
      { key: 'training-list', glyph: '训', title: '教研培训', desc: '研修与反馈', tone: 'green' },
    ],
  },

  onShow() {
    this.load();
  },

  /**
   * 一次取回三块。服务端那边「推荐」是按最新派生的，这里**不再挑一次** ——
   * 客户端再挑就变成两套规则，而两套规则一定会漂。
   */
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const home = await training.getTrainingHome();
      this.setData({
        loading: false,
        banners: home.banners,
        resources: home.resources,
        cases: home.cases,
        // 轮播回来了就把它归零，否则换数据后指示点停在上一组的位置上。
        bannerIndex: 0,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        banners: [],
        resources: [],
        cases: [],
        error: err.userMessage || '教研培训首页加载失败，请稍后重试',
      });
    }
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
