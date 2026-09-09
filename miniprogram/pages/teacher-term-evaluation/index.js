/**
 * 教师学期评价 —— 接 `GET /term-evaluations`（services/assessment.js）。
 *
 * **对外二元**：一名幼儿的学期评价只有「已完成 / 未完成」两态（E4 / decision.md
 * 第 14 条）。契约的 `db_term_eval` 值域只有 c1 / c2，没有对外的草稿。
 *
 * 原型的「添加评价」按钮去掉了：契约里没有「新增」这个动作 —— 一名幼儿一列，
 * 行由本班在园名册决定，进填写只能从圆点走。
 *
 * 浮层里的勾选口径照抄原型：
 *   「全选」把所有行设成和自己一样；
 *   单行改动后，「全选」只在全部行都勾上时才亮；
 *   导出和发送在一个都没勾时只弹提示，不关浮层。
 *
 * **导出与发送在契约里没有端点**（全文搜 `export` 只命中 1 处，且不是路径）。
 * 浮层保留，两个按钮只弹「待接入」。
 */

const assess = require('../../services/assessment.js');

Page({
  data: {
    rows: [],
    allChecked: false,
    exportOpen: false,
  },

  /** 从填写页返回要重新取：那一页会把某一格从未完成改成已完成。 */
  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const board = await assess.termEvaluationBoard();
      // 勾选是本页的本地态，不来自服务端。初始勾上已完成的那几个（照抄原型）。
      const rows = board.rows.map((row) => ({ ...row, checked: row.done }));
      this.setData({
        rows,
        allChecked: rows.length > 0 && rows.every((row) => row.checked),
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '进度加载失败，请稍后重试', icon: 'none' });
    }
  },

  onDotTap(e) {
    const { childId, childName, done } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/teacher-term-form/index?childId=${childId}`
        + `&childName=${encodeURIComponent(childName)}${done ? '&view=1' : ''}`,
    });
  },

  onOpenExport() {
    this.setData({ exportOpen: true });
  },

  onCloseExport() {
    this.setData({ exportOpen: false });
  },

  onToggleAll() {
    const allChecked = !this.data.allChecked;
    this.setData({
      allChecked,
      rows: this.data.rows.map((row) => ({ ...row, checked: allChecked })),
    });
  },

  onToggleRow(e) {
    const i = Number(e.currentTarget.dataset.index);
    const rows = this.data.rows.map((row, index) => (index === i ? { ...row, checked: !row.checked } : row));
    this.setData({ rows, allChecked: rows.every((row) => row.checked) });
  },

  onExport() {
    this.finish('导出');
  },

  onSend() {
    this.finish('发送');
  },

  /** 契约里没有导出／发送端点，所以这里只报「选了几个」与「待接入」，不谎称做完了。 */
  finish(what) {
    const count = this.data.rows.filter((row) => row.checked).length;
    if (!count) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    this.setData({ exportOpen: false });
    wx.showToast({ title: `已选 ${count} 名幼儿，${what}待接入`, icon: 'none' });
  },
});
