/**
 * 发布家长测评 —— 教师给家长开一次评价窗口。
 *
 * ── 这一页一半接了、一半接不了 ─────────────────────────────────────────────
 *
 * **底下的历史列表是真数据**：`GET /home-school/parent-evaluations` 取回全班全部期间，
 * 经 `parentEvalPeriods()` 按 `evaluation_type + evaluation_period` 折成一组一行。
 * 每组的分母是**那一组真实的行数**，不是班级人数 —— 中途转入的幼儿可能没有上个月
 * 那一份，写死班级人数会让分母比分子大得莫名其妙。
 *
 * **顶上的「发布给家长」接不了**：`POST /home-school/parent-evaluations` 在契约上标着
 * `x-hualong-blocked-on: G50`，服务端照实回 501。缺的是一个决策而不是实作 ——
 * 一次开窗到底为**哪些幼儿**建行（全班 fan-out、教师勾选子集、还是家长首次进入时
 * 惰性建行）没人定过。在拍板之前 `p0` 没有生产者，家长侧那三个已登记的动作在运行时
 * 无行可操作。所以这个按钮**照实说明情况，不假装发布成功**。
 *
 * ── 点某一期要把期间带过去 ─────────────────────────────────────────────────
 *
 * 此前 `onHistoryTap` 不带任何参数，测评进度页因此只能显示「最近动过的那一期」——
 * 于是列表上点的是 6 月，进去看到的是学期评价，两边数字对不上。
 * 现在带 `type` 与 `period` 两个查询参数过去。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

Page({
  data: {
    types: ['月度评价', '学期评价'],
    typeIndex: 0,
    prompt: '请家长结合本月亲子任务、幼儿在家表现与照片记录，补充孩子的兴趣、生活习惯和成长变化。',

    history: [],
    loading: true,
    failed: '',
    publishing: false,
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, failed: '' });
    try {
      await guard.requireSession();
      const history = await co.parentEvalPeriods({});
      this.setData({ history, loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        history: [],
        loading: false,
        failed: err.userMessage || '过往进度加载失败，请稍后重试',
      });
    }
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
  },

  onPromptInput(e) {
    this.setData({ prompt: e.detail.value });
  },

  /**
   * 发布。**服务端会回 501**，这里照实把原因说清楚，不弹一个「已发布」骗人。
   *
   * 仍然真的打这一发而不是本地拦下：G50 一旦拍板、实作跟上，这一页不用改就能用；
   * 本地拦下的话，那天没人会记得回来把拦截删掉。
   */
  async onPublish() {
    if (this.data.publishing) return;
    this.setData({ publishing: true });
    try {
      await co.openParentEvaluationWindow({
        type: this.data.typeIndex === 0 ? 't1' : 't2',
        prompt: this.data.prompt,
      });
      this.setData({ publishing: false });
      wx.showToast({ title: '已发布给家长', icon: 'none' });
      this.refresh();
    } catch (err) {
      this.setData({ publishing: false });
      wx.showModal({
        title: '暂时发布不了',
        content: err.code === 'not_implemented'
          ? '「一次开窗为哪些幼儿建行」这条规则还没定（缺口 G50），服务端因此拒绝这次写入。定了之后这一页不用改就能用。'
          : (err.userMessage || '发布失败，请稍后重试'),
        showCancel: false,
      });
    }
  },

  /** 点某一期进测评进度，把期间带过去 —— 不带的话那一页只能猜。 */
  onHistoryTap(e) {
    const row = this.data.history[Number(e.currentTarget.dataset.index)];
    if (!row) return;
    wx.navigateTo({
      url: `/pages/parent-evaluation-detail/index?type=${row.type}&period=${row.period}`,
    });
  },
});
