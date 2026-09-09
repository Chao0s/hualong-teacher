/**
 * 综合评估 —— 接 `GET /child-assessments`（services/assessment.js）。
 *
 * 三态由 service 的 `tristate()` 按 `completed_count` / `required_count` 判，
 * 页面不再判：
 *   miss  一题未评（含无主记录）→ 按钮「填写」
 *   draft 填了但没填满          → 按钮「继续」
 *   done  124 题填满            → 按钮「查看」
 *
 * **这一页是全库唯一允许显示草稿的地方**（E4 / decision.md 第 14 条）。
 * 任何聚合视图（班级报告、成长档案的「综合」那一列）一律走 `binaryDone()`，
 * 草稿折算未完成。
 *
 * 导出浮层里只列可导出的（已完成和草稿），未开始的不列 —— 原型的四行就是这么来的。
 * 「草稿 · 可导出当前版本」那一行照 decision.md §6.2 留着。
 * **契约里没有导出端点**，按钮只报「待接入」。
 */

const assess = require('../../services/assessment.js');

Page({
  data: {
    doneRatio: '0/0',
    students: [],
    exportOpen: false,
    exportables: [],
    allChecked: false,
  },

  /** 从填写页返回要重新取，等价于原型监听 pageshow。 */
  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const board = await assess.childAssessmentProgress();
      // 导出浮层：已完成与草稿都列，未开始的不列（`state !== 'miss'`）。
      const exportables = board.rows
        .filter((row) => row.state !== 'miss')
        .map((row) => ({
          childId: row.childId,
          name: row.name,
          desc: row.state === 'done' ? '已完成 · 可导出' : '草稿 · 可导出当前版本',
          checked: row.state === 'done',
        }));
      this.setData({
        students: board.rows,
        doneRatio: `${board.summary.done}/${board.summary.total}`,
        exportables,
        allChecked: exportables.length > 0 && exportables.every((row) => row.checked),
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '进度加载失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 「开始评估」进第一个还没填满的幼儿。
   *
   * 契约里没有「新建评估」这个动作 —— 主记录在首次评分时由服务端建立，
   * 所以这个按钮只能带着某名幼儿的 `child_id` 进填写页。全班都填满时没有可去处。
   */
  onStart() {
    const next = this.data.students.find((row) => row.state !== 'done');
    if (!next) {
      wx.showToast({ title: '全班都已完成综合评估', icon: 'none' });
      return;
    }
    this.openChild(next.childId, next.name, next.state);
  },

  onClassReport() {
    wx.navigateTo({ url: '/pages/comprehensive-assessment-class-report/index' });
  },

  // 已完成的去看结果，草稿和未开始的去填写
  onStudentTap(e) {
    const { childId, childName, state } = e.currentTarget.dataset;
    this.openChild(childId, childName, state);
  },

  openChild(childId, childName, state) {
    const page = state === 'done' ? 'comprehensive-assessment-report' : 'comprehensive-assessment-form';
    wx.navigateTo({
      url: `/pages/${page}/index?childId=${childId}&childName=${encodeURIComponent(childName)}`,
    });
  },

  /* ── 导出浮层 ──────────────────────────────────────────────────────── */

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
      exportables: this.data.exportables.map((row) => ({ ...row, checked: allChecked })),
    });
  },

  onToggleRow(e) {
    const i = Number(e.currentTarget.dataset.index);
    const exportables = this.data.exportables.map((row, index) => (
      index === i ? { ...row, checked: !row.checked } : row
    ));
    this.setData({ exportables, allChecked: exportables.every((row) => row.checked) });
  },

  /** 契约里没有导出端点，所以只报「选了几个」与「待接入」，不谎称做完了。 */
  onConfirmExport() {
    const count = this.data.exportables.filter((row) => row.checked).length;
    if (!count) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    this.setData({ exportOpen: false });
    wx.showToast({ title: `已选 ${count} 名幼儿，导出待接入`, icon: 'none' });
  },
});
