/**
 * 后勤资料列表页 — APP-STRUCTURE.md screen id `HQList`.
 *
 * 两个类目（安全管理／卫生保健）走页内标签，一个标签一个类目，因为端点的
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

const GROUP = 'hq';

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

  onLoad() {
    if (!guard.requireSession()) return;
    const categories = coordination.categoriesFor(GROUP);
    this.setData({
      ready: true,
      categories,
      filters: { coord_category: categories[0].key },
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
    wx.navigateTo({ url: `/packages/coordination/pages/hq/detail?document_id=${id}` });
  },
});
