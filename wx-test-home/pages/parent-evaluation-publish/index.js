/** 发布家长测评 —— 原型 screens/parent-evaluation-publish.html 的小程序版本。 */

Page({
  data: {
    types: ['月度评价', '学期评价'],
    typeIndex: 0,
    prompt: '请家长结合本月亲子任务、幼儿在家表现与照片记录，补充孩子的兴趣、生活习惯和成长变化。',

    history: [
      { month: '6月', tone: '', title: '2026年6月家长月度评价', meta: '总体完成 82% · 23/28 已提交' },
      { month: '5月', tone: 'green', title: '2026年5月家长月度评价', meta: '总体完成 93% · 26/28 已提交' },
      { month: '4月', tone: 'blue', title: '2026年4月家长月度评价', meta: '总体完成 100% · 28/28 已提交' },
    ],
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  onPromptInput(e) {
    this.setData({ prompt: e.detail.value });
  },

  onPublish() {
    wx.showToast({ title: '已发布给家长（预览工程不落库）', icon: 'none' });
  },

  onHistoryTap() {
    wx.navigateTo({ url: '/pages/parent-evaluation-detail/index' });
  },
});
