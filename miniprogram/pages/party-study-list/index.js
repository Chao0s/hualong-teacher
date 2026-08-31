/**
 * 党建学习 · 全部文件 —— 数据来自 `GET /party/studies`。
 *
 * 原型把 5 条文件写死在这里；已经删掉。列表行的「类型 · 日期 · 部门」三段元信息
 * 在服务层拼好（`db_party_study` 的 study_type／published_at／publisher_department），
 * 这一页不译枚举也不格式化日期。
 *
 * 教师只读得到已发布（`s3`）的文件 —— 管理员的草稿与已下架的内容由服务端挡在
 * 范围外，客户端不需要、也不应该自己再过滤一遍。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

Page({
  data: {
    docs: [],
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
      const page = await party.listStudies({ limit: PAGE_LIMIT });
      this.setData({ docs: page.items, nextCursor: page.nextCursor, loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        docs: [],
        error: err.userMessage || '学习文件加载失败，请稍后重试',
      });
    }
  },

  /**
   * 触底翻页。游标为空是结束的唯一信号（契约 §3.1，DO-NOT-BUILD 11）——
   * 没有页号、没有偏移量、也没有总数可以拿来判断还有没有下一页。
   */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await party.listStudies({ cursor: this.data.nextCursor, limit: PAGE_LIMIT });
      this.setData({
        docs: this.data.docs.concat(page.items),
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
    wx.navigateTo({ url: `/pages/party-study-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
