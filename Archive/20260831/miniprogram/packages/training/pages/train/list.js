/**
 * 研修列表页 — APP-STRUCTURE.md screen id `TrainList`.
 *
 * 一个切分维度，横排标签：最新／历史（form-control-spec.md §1 第 2 问 —— 单选，
 * 2 项＋全部，取值固定）。**这一页因此一个滚轮也没有**，这是判据的结果，不是遗漏。
 *
 * 原型 training-list.html 把「最新研修」与「历史研修」做成两个各带一个「更多」链接的区。
 * 这里做成一行标签而不是两个区：契约的 `phase` 参数一次只收一个值，两个区就是两次读取
 * 加两套游标，而游标属于签发它的那一组条件（§3.3）。一行标签是同一件事的单份实现。
 *
 * 换标签走 `filters` 通道再 `loadFirst()`，旧游标因此被丢弃。
 *
 * 本页没有报名、反馈或评论入口 —— 那些是票据 16 与 18 的事（票据 14 正文点名）。
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/training.js, so this file names no endpoint and formats nothing.
 */

const guard = require('../../../../utils/guard');
const training = require('../../../../services/training');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
    phaseOptions: [],
    // 空串即「全部」：buildQuery 丢掉空串，「不切分」就是不发这个参数。
    filters: { phase: '' },
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
    this.setData({ ready: true, phaseOptions: training.phaseFilters() });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /** Reaching the bottom is the only way more rows arrive. */
  onReachBottom() {
    this.loadMore();
  },

  ...createListMethods({ fetchPage: training.listTrainings }),

  /**
   * 换分区就是换筛选集：旧游标作废，从头读一页。
   *
   * 先清空 items 是有用的：`loadFirst` 失败时会保留原有的行，那些行属于上一个分区，
   * 留在新标签下就是在骗人。
   */
  onPhaseTap(e) {
    const { key } = e.currentTarget.dataset;
    if (this.data.filters.phase === key) return;
    this.setData({ filters: { phase: key }, items: [] });
    return this.loadFirst();
  },

  /** 原型顶部那两张入口卡。个人档案自成一个分包，路径写全。 */
  onProfileTap() {
    wx.navigateTo({ url: '/packages/profile/pages/mine/index' });
  },

  onMineTap() {
    wx.navigateTo({ url: '/packages/training/pages/mine/list' });
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/training/pages/train/detail?training_id=${id}` });
  },
});
