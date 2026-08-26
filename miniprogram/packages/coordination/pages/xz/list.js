/**
 * 行政资料列表页 — APP-STRUCTURE.md screen id `XZList`.
 *
 * 三个类目（政策法规／通知文件／组织架构）走页内标签，一个标签一个类目，因为端点的
 * `coord_category` 一次只收一个值。切标签走 `filters` 通道再 `loadFirst()`，游标
 * 因此被丢弃（§3.3：游标属于签发它的那一组筛选条件）。
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/coordination.js, so this file names no endpoint and formats nothing.
 */

const guard = require('../../../../utils/guard');
const coordination = require('../../../../services/coordination');
const { createListMethods } = require('../../../../utils/list-page');

const GROUP = 'xz';

Page({
  data: {
    ready: false,
    categories: [],
    filters: { coord_category: '' },
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  /**
   * 入口页的卡片带着 `coord_category` 进来，那一类就是开场标签；直接进本页（无参）
   * 则停在第一类。**不认识的取值一律回落到第一类**：真让它进 `filters` 会换来一个
   * 400，而那是我们自己造的，不是服务端的问题。
   */
  onLoad(query) {
    if (!guard.requireSession()) return;
    const categories = coordination.categoriesFor(GROUP);
    const asked = query && query.coord_category;
    const opening = categories.some((c) => c.key === asked) ? asked : categories[0].key;
    this.setData({
      ready: true,
      categories,
      filters: { coord_category: opening },
    });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /** Reaching the bottom is the only way more rows arrive. */
  onReachBottom() {
    this.loadMore();
  },

  ...createListMethods({ fetchPage: coordination.listDocuments }),

  /**
   * 换类目就是换筛选集：旧游标作废，从头读一页。
   *
   * 先清空 items 是有用的：`loadFirst` 失败时会保留原有的行，那些行属于上一个类目，
   * 留在新标签下就是在骗人。
   */
  onCategoryTap(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.filters.coord_category) return;
    this.setData({ filters: { coord_category: key }, items: [] });
    return this.loadFirst();
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/coordination/pages/xz/detail?document_id=${id}` });
  },
});
