/**
 * 开始综合评估 —— 接 `GET /children/{child_id}/child-assessment` 与
 * `PUT /children/{child_id}/child-assessment/items/{item_id}`（services/assessment.js）。
 *
 * 题库在 `../../data/guide-scale.js`（权威，124 题，含提问和 1／3／5 锚点）。
 * 题库 × 已评分的合并在 service 的 `buildDomains()` 里做，页面只循环。
 *
 * **逐题即时落库，没有本机草稿。** `PUT .../items/{item_id}` 就是增量保存，契约明写
 * 中途退出可续填 —— 本机再存一份是「一份复制品静默过期」，而页面显示的是哪一份
 * 没有任何规则可查。
 *
 * **未评 = 该题无列，不是 0 分。** `score` 为 0 只是给 wxml 的显示值（不高亮任何
 * 一档），均值一律走 service 的 `rated`。
 *
 * 一处优化：折叠的领域不渲染题目。124 题全展开是几千个节点，小程序会卡；
 * 折叠态本来就看不见，行为一致。
 */

const assess = require('../../services/assessment.js');

Page({
  data: {
    // 名册整份（真名册）。picker 的 range 是 { childId, name } 数组。
    children: [],
    childIndex: 0,
    childId: null,
    scaleNums: [1, 2, 3, 4, 5],
    domains: [],
    avg: '—',
    progressHint: '',
    readonly: false,
    pendingWrites: 0,
  },

  async onLoad(options) {
    const wanted = Number(options.childId) || null;
    try {
      const board = await assess.childAssessmentProgress();
      let index = board.rows.findIndex((row) => row.childId === wanted);
      if (index < 0) index = 0;
      this.setData({
        children: board.rows.map((row) => ({ childId: row.childId, name: row.name })),
        childIndex: index,
      });
      await this.loadChild();
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '加载失败，请返回重试', icon: 'none' });
    }
  },

  async loadChild() {
    const child = this.data.children[this.data.childIndex];
    if (!child) return;
    const epoch = (this.childEpoch || 0) + 1;
    this.childEpoch = epoch;
    this.setData({ childId: child.childId, domains: [], readonly: false });
    const detail = await assess.getChildAssessment(child.childId);
    if (epoch !== this.childEpoch) return;
    this.setData({ childId: child.childId, ...this.viewOf(detail) });
  },

  /** service 的返回值直接摊进 data，页面一格都不再算。 */
  viewOf(detail, preserveOpen = false) {
    const opened = new Map(this.data.domains.map((domain) => [domain.id, domain.open]));
    return {
      domains: detail.domains.map((domain) => ({
        ...domain,
        open: preserveOpen ? Boolean(opened.get(domain.id)) : domain.open,
      })),
      avg: detail.avg,
      progressHint: detail.progressHint,
      // 已完成的那一份改分服务端现在会回 404（见 service 的头注），提示语照实说。
      readonly: detail.state === 'done',
    };
  },

  async onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value) });
    try {
      await this.loadChild();
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '加载失败，请稍后重试', icon: 'none' });
    }
  },

  onUnload() {
    this.disposed = true;
    this.childEpoch = (this.childEpoch || 0) + 1;
  },

  onToggleDomain(e) {
    const di = e.currentTarget.dataset.di;
    if (!this.data.domains[di]) return;
    this.setData({ [`domains[${di}].open`]: !this.data.domains[di].open });
  },

  /**
   * 打一题分。
   *
   * 先乐观更新那一格再落库 —— 124 题逐题打分，每次等一个往返会很难用。
   * 落库失败要把那一格**退回去**，不能留一个只在屏幕上存在的分。
   */
  async onScoreTap(e) {
    const { di, ii, score } = e.currentTarget.dataset;
    const item = this.data.domains[di] && this.data.domains[di].items[ii];
    if (!item || this.data.readonly) return;
    const childId = this.data.childId;
    const epoch = this.childEpoch;
    const sameChild = () => this.data.childId === childId && this.childEpoch === epoch;
    this.setData({ pendingWrites: this.data.pendingWrites + 1 });
    // 按点击顺序保存，避免较早请求最后返回覆盖新分数；切换幼儿后旧请求只落库，不改新页面。
    const save = async () => {
      const current = sameChild() && this.data.domains[di] && this.data.domains[di].items[ii];
      const before = current ? { score: current.score, rated: current.rated } : null;
      if (before) this.setData({
        [`domains[${di}].items[${ii}].score`]: Number(score),
        [`domains[${di}].items[${ii}].rated`]: true,
      });
      try {
        const fresh = await assess.scoreItem(childId, item.id, score);
        if (sameChild()) this.setData(this.viewOf(fresh, true));
      } catch (err) {
        if (sameChild() && before) this.setData({
          [`domains[${di}].items[${ii}].score`]: before.score,
          [`domains[${di}].items[${ii}].rated`]: before.rated,
        });
        wx.showToast({ title: assess.scoreFailureText(err), icon: 'none' });
      } finally {
        if (!this.disposed) this.setData({ pendingWrites: Math.max(0, this.data.pendingWrites - 1) });
      }
    };
    this.scoreQueue = (this.scoreQueue || Promise.resolve()).then(save, save);
    return this.scoreQueue;
  },

  /**
   * 「保存」没有对应的端点 —— 每一题在点下去那一刻就已经落库了。
   * 按钮留着（教师会找它），文案照实说已经保存到哪一步。
   */
  onSave() {
    wx.showToast({ title: this.data.pendingWrites ? '评分正在保存，请稍候' : this.data.progressHint, icon: 'none' });
  },
});
