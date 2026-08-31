/**
 * 品牌建设 · 全部主题 —— 数据来自 `GET /party/brands`。
 *
 * 原型把 4 个品牌写死在这里；已经删掉。
 *
 * 卡片左侧那个字（原型是 科／狮／园／读）是照着假数据的名字一条条捏的，
 * `db_party_brand` 没有图标列。服务层改取标题首字：对任何一条真实数据都有定义，
 * 也不需要动样式。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

Page({
  data: {
    brands: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await party.listBrands({ limit: PAGE_LIMIT });
      this.setData({ brands: page.items, nextCursor: page.nextCursor, loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        brands: [],
        error: err.userMessage || '品牌主题加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（契约 §3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await party.listBrands({ cursor: this.data.nextCursor, limit: PAGE_LIMIT });
      this.setData({
        brands: this.data.brands.concat(page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (err) {
      this.setData({ loadingMore: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '加载更多失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/party-brand-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
