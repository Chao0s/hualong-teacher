/**
 * 我的研修 —— 数据来自 `GET /training-participations`。
 *
 * 它是研修列表的**子集**，不是第二份活动表（规则 21）：每一行是一条本人的
 * participation，里面内嵌一张研修卡片。`teacher_id` 是 derived，客户端不发。
 *
 * ── 徽章读的是参与状态，不是活动阶段 ───────────────────────────────────────
 *
 * 这一页回答的是「我跟这场研修的关系」：已报名／已取消／已完成。
 * 活动本身是「未开始」还是「已结束」放在下面那行时间里，两个不要混成一个徽章 ——
 * 「已取消的未开始活动」和「已报名的未开始活动」对教师是完全不同的两件事。
 *
 * ── 撤回的活动仍然列出来 ───────────────────────────────────────────────────
 *
 * 报名记录不因为活动被撤回而消失 —— 那是教师真的报过的名。卡片照常显示，
 * 只在脚上标一句「活动已撤回」。**但它点不进去**：详情端点对 `s5` 只回壳，
 * 进去只会看到一句「已撤回」，不如在这里就说清楚。
 */

const training = require('../../services/training');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

Page({
  data: {
    records: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await training.listMyParticipations({ limit: PAGE_LIMIT });
      this.setData({
        records: page.items.map(toRecord),
        nextCursor: page.nextCursor,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        records: [],
        error: err.userMessage || '研修记录加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（§3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await training.listMyParticipations({
        cursor: this.data.nextCursor, limit: PAGE_LIMIT,
      });
      this.setData({
        records: this.data.records.concat(page.items.map(toRecord)),
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

  onCardTap(e) {
    const id = Number(e.currentTarget.dataset.id);
    // 撤回的活动点不进去，见头注。
    if (!id) return;
    wx.navigateTo({ url: `/pages/training-detail/index?id=${id}` });
  },
});

/**
 * 一条报名记录。**所有判断都在这里做完**，模板只读属性。
 *
 * 脚上那两个胶囊放有据可查的：活动阶段与报名／取消的时刻。
 * 原型写的「研修材料 4」「反馈已提交」两个都不行 —— 材料数只在详情里有，
 * 而「自己交没交过反馈」客户端根本读不到（作者不可查询自己那一份的状态，F9）。
 */
function toRecord(p) {
  const t = p.training || {};
  const withdrawn = t.withdrawn === true;
  const pills = [];
  if (t.phaseLabel) pills.push(t.phaseLabel);
  if (p.status === 's2' && p.cancelledLabel) pills.push(`${p.cancelledLabel} 取消`);
  else if (p.registeredLabel) pills.push(`${p.registeredLabel} 报名`);
  if (withdrawn) pills.push('活动已撤回');

  return {
    key: p.id,
    // 撤回的活动点不进去，所以不给 id。
    id: withdrawn ? 0 : p.trainingId,
    tappable: !withdrawn,
    title: t.title || '（未命名）',
    // 徽章是**参与状态**：已报名／已取消／已完成。
    state: p.tone,
    stateText: p.statusLabel,
    meta: t.hasEnd ? `${t.startStamp} — ${t.endStamp}` : t.startStamp,
    summary: t.excerpt || '',
    pills,
  };
}
