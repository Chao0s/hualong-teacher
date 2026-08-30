/**
 * 综合评估 —— 原型 screens/growth-comprehensive-assessment.html 的小程序版本。
 *
 * 状态口径全部来自共用的 AssessStore（utils/assessment-store.js）：
 *   miss  没填过         → 按钮「填写」
 *   draft 填了但没填满   → 按钮「继续」
 *   done  124 题填满     → 按钮「查看」
 *
 * 导出浮层里只列可导出的（已完成和草稿），未开始的不列 —— 原型的四行就是这么来的。
 * 初始勾选是「已完成的那两个」，草稿不勾，也照抄。
 */

const { ASSESS_CHILDREN, AssessStore } = require('../../utils/assessment-store.js');

const LABEL = { done: '已完成', draft: '草稿', miss: '未完成' };

Page({
  data: {
    doneRatio: '0/0',
    students: [],
    exportOpen: false,
    exportables: [],
    allChecked: false,
  },

  onLoad() {
    AssessStore.seedIfEmpty();
  },

  /** 从填写页返回时要重新算，等价于原型监听 pageshow。 */
  onShow() {
    this.refresh();
  },

  refresh() {
    const all = AssessStore.read() || {};

    const students = ASSESS_CHILDREN.map((child) => {
      const record = all[child.id];
      const state = AssessStore.statusOf(record);
      const rated = record ? record.rated : 0;
      return {
        id: child.id,
        name: child.name,
        state,
        stateLabel: LABEL[state],
        sub: state === 'done' ? `五大领域 ${AssessStore.TOTAL} 题已全部完成`
          : state === 'draft' ? `已填写 ${rated}/${AssessStore.TOTAL} 题，可继续完成`
            : '尚未开始填写',
        action: state === 'done' ? '查看' : state === 'draft' ? '继续' : '填写',
      };
    });

    const done = students.filter((s) => s.state === 'done').length;
    const exportables = students
      .filter((s) => s.state !== 'miss')
      .map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.state === 'done' ? '已完成 · 可导出' : '草稿 · 可导出当前版本',
        checked: s.state === 'done',
      }));

    this.setData({
      students,
      doneRatio: `${done}/${ASSESS_CHILDREN.length}`,
      exportables,
      allChecked: exportables.length > 0 && exportables.every((row) => row.checked),
    });
  },

  onStart() {
    wx.navigateTo({ url: '/pages/comprehensive-assessment-form/index' });
  },

  onClassReport() {
    wx.navigateTo({ url: '/pages/comprehensive-assessment-class-report/index' });
  },

  // 已完成的去看结果，草稿和未开始的去填写
  onStudentTap(e) {
    const { id, state } = e.currentTarget.dataset;
    const page = state === 'done' ? 'comprehensive-assessment-report' : 'comprehensive-assessment-form';
    wx.navigateTo({ url: `/pages/${page}/index?child=${id}` });
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

  onConfirmExport() {
    const count = this.data.exportables.filter((row) => row.checked).length;
    if (!count) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    this.setData({ exportOpen: false });
    wx.showToast({ title: `已生成 ${count} 份导出报告`, icon: 'none' });
  },
});
