/**
 * 我的研修 — APP-STRUCTURE.md screen id `MyTraining`。
 *
 * 原型 `screens/my-training.html`。2026-08-27 补建：这一页此前整页没有，研修列表顶部
 * 那一节「我的档案」的两张入口卡也没有，所以教师无处看自己报过哪些研修。
 *
 * §4 规则 21：「我的研修」只查本人 participation，**是活动列表的子集，不是第二份活动表**。
 * 契约的 `TrainingParticipation` 内嵌一整张 `TrainingCard`，所以这一页读一次就够。
 *
 * 只读。报名与取消报名都在研修详情上（原型也是那样分的）。
 */

const guard = require('../../../../utils/guard');
const training = require('../../../../services/training');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
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
    this.setData({ ready: true });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /** 原型这一页没有「加载更多」按钮，也没有触底提示 —— 它是静态的五条。
   *  游标分页要有一条路把下一页读进来，取按钮而不是触底：与本仓其余列表一致。 */
  onMoreTap() {
    if (this.data.loadingMore || this.data.exhausted) return;
    this.loadMore();
  },

  ...createListMethods({ fetchPage: training.listMyParticipations }),

  /** 已撤回的研修点不进去 —— 原型最后那张卡就没有链接。 */
  onTap(e) {
    const { id, withdrawn } = e.currentTarget.dataset;
    if (withdrawn) return;
    wx.navigateTo({ url: `/packages/training/pages/train/detail?training_id=${id}` });
  },
});
