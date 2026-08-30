/**
 * 在园时光 · 全部活动 — APP-STRUCTURE.md screen id `MomentFeed`。
 *
 * 原型 `screens/home-school-moment-feed.html`。2026-08-27 补建：这一页此前整页没有，
 * 连 `home-school-moments.html` 上通往它的那个「全部活动」链接也没有。端点
 * （`GET /moments`）一直在契约里，是单纯漏建。
 *
 * 只读一件事之外：原型每张卡右下角有一枚「＋ 加入成长册」。**那一枚点得下去，但办不成** ——
 * 契约里没有「把一则在园时光收进成长资料」的动作（登记表只有亲子任务提交那一条
 * `parent_task_submission.book_include_teacher`）。园方 2026-08-27 裁定：画不出的控件照画，
 * 点了说明原因。缺口记在票据 27。
 *
 * 照片按 §4 规则 1 逐张现签地址，**不提供下载、存相簿、分享或收藏**。
 */

const guard = require('../../../../utils/guard');
const coEducation = require('../../../../services/co-education');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    // 「加入成长册」点下去之后就地写出的一句理由。不弹窗：这一页有位置说话。
    notice: '',
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  onMoreTap() {
    if (this.data.loadingMore || this.data.exhausted) return;
    this.loadMore();
  },

  ...createListMethods({ fetchPage: coEducation.listMomentFeed }),

  /** 点开一张照片。地址已经签好了，这一步不再跑网络。 */
  onPhotoTap(e) {
    const { moment, index } = e.currentTarget.dataset;
    const row = this.data.items.find((m) => m.moment_id === Number(moment));
    const urls = ((row && row.photos) || []).map((p) => p.url);
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[Number(index) || 0] });
  },

  /** 原型那一枚「＋ 加入成长册」。契约给不出这个动作，所以点了只说明原因。 */
  onAddToBookTap() {
    this.setData({
      notice: '「加入成长册」还没有开放：成长册的「在园时光」栏目目前由园所统一收录，本班发布的活动会自动进入。',
    });
  },
});
