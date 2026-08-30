/**
 * 教师学期评价 —— 原型 screens/teacher-term-evaluation.html 的小程序版本。
 *
 * 浮层里的勾选口径照抄原型：
 *   「全选」把所有行设成和自己一样；
 *   单行改动后，「全选」只在全部行都勾上时才亮；
 *   导出和发送在一个都没勾时只弹提示，不关浮层。
 *
 * 注意原型的初始勾选是「已完成的三个」，不是全部。
 */

Page({
  data: {
    rows: [
      { child: 'chen', name: '陈小明', done: true, checked: true },
      { child: 'li', name: '李雨萱', done: false, checked: false },
      { child: 'zhang', name: '张力轩', done: false, checked: false },
      { child: 'wang', name: '王子涵', done: true, checked: true },
      { child: 'zhao', name: '赵佳怡', done: false, checked: false },
      { child: 'liu', name: '刘浩然', done: true, checked: true },
    ],
    allChecked: false,
    exportOpen: false,
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/teacher-term-form/index' });
  },

  onDotTap(e) {
    const { child, done } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/teacher-term-form/index?child=${child}${done ? '&view=1' : ''}` });
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
    this.finish('已生成', '份评价报告');
  },

  onSend() {
    this.finish('已发送', '份评价给家长');
  },

  finish(verb, tail) {
    const count = this.data.rows.filter((row) => row.checked).length;
    if (!count) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    this.setData({ exportOpen: false });
    wx.showToast({ title: `${verb} ${count} ${tail}`, icon: 'none' });
  },
});
