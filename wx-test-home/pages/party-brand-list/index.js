/** 品牌建设 · 全部主题 —— 原型 screens/party-brand-list.html 的小程序版本。 */

Page({
  data: {
    brands: [
      { id: 'steam', glyph: '科', title: '科技启蒙：小小工程师项目', meta: '科学探究 · 园本特色' },
      { id: 'dragon', glyph: '狮', title: '醒狮文化：岭南艺术体验', meta: '艺术表达 · 本土课程' },
      { id: 'garden', glyph: '园', title: '自然花园：劳动教育实践', meta: '劳动教育 · 班级共建' },
      { id: 'reading', glyph: '读', title: '书香班级：亲子阅读共建', meta: '语言发展 · 家园协同' },
    ],
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/party-brand-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
