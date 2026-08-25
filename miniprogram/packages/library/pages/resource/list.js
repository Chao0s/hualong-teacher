/**
 * 资源列表页 — APP-STRUCTURE.md screen id `ResourceList`.
 *
 * 两个筛选维度，都是横排标签：分类（衣食住行艺，5 项）与年级（3 项）。
 * 判据在 docs/frontend spec files/form-control-spec.md §1 —— 单选且选项 ≤ 6，
 * 一屏放得下就一眼看全，不必弹层。**这一页因此一个滚轮也没有**，这是判据的结果，
 * 不是遗漏。
 *
 * 换任一筛选走 `filters` 通道再 `loadFirst()`，旧游标因此被丢弃（§3.3：游标属于
 * 签发它的那一组筛选条件）。两个维度同时进 `filters`，所以组合筛选不需要额外代码。
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/library.js, so this file names no endpoint and formats nothing.
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
    tagOptions: [],
    gradeOptions: [],
    // 空串即「全部」：buildQuery 丢掉空串，「不筛」就是不发这个参数。
    filters: { resource_tag: '', grade: '' },
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    this.setData({
      ready: true,
      tagOptions: library.tagFilters(),
      gradeOptions: library.gradeFilters(),
      // 入口页可以带着一个分类进来。未带就是全部。
      filters: { resource_tag: query.resource_tag || '', grade: '' },
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

  ...createListMethods({ fetchPage: library.listResources }),

  /**
   * 换筛选就是换筛选集：旧游标作废，从头读一页。
   *
   * 两个维度共用这一个处理器，`field` 说的是改哪一维。先清空 items 是有用的：
   * `loadFirst` 失败时会保留原有的行，那些行属于上一组筛选条件，留在新标签下就是
   * 在骗人。
   */
  onFilterTap(e) {
    const { field, key } = e.currentTarget.dataset;
    if (this.data.filters[field] === key) return;
    this.setData({
      filters: { ...this.data.filters, [field]: key },
      items: [],
    });
    return this.loadFirst();
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/library/pages/resource/detail?resource_id=${id}` });
  },
});
