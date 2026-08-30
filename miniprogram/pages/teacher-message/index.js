/**
 * 教师寄语 —— 原型 screens/teacher-message.html 的小程序版本。
 *
 * 两处行为照抄原型：
 *   1. 提交时寄语为空只弹提示；选「全体幼儿」和选具体幼儿的提示文案不同。
 *   2. 点未完成的圆点，把上方「添加到」切到那个幼儿，滚回顶部并聚焦输入框。
 */

const TARGETS = [
  { key: 'all', name: '全体幼儿' },
  { key: 'chen', name: '陈小明' },
  { key: 'li', name: '李雨萱' },
  { key: 'zhang', name: '张力轩' },
  { key: 'wang', name: '王子涵' },
  { key: 'zhao', name: '赵佳怡' },
  { key: 'liu', name: '刘浩然' },
];

Page({
  data: {
    targets: TARGETS,
    targetIndex: 0,
    text: '',
    focusInput: false,

    rows: [
      { child: 'chen', name: '陈小明', done: true },
      { child: 'li', name: '李雨萱', done: false },
      { child: 'zhang', name: '张力轩', done: false },
      { child: 'wang', name: '王子涵', done: false },
      { child: 'zhao', name: '赵佳怡', done: false },
      { child: 'liu', name: '刘浩然', done: true },
    ],
  },

  onTargetChange(e) {
    this.setData({ targetIndex: Number(e.detail.value) });
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value });
  },

  onSubmit() {
    if (!this.data.text.trim()) {
      wx.showToast({ title: '请先填写寄语内容', icon: 'none' });
      return;
    }
    const target = TARGETS[this.data.targetIndex];
    wx.showToast({
      title: target.key === 'all' ? '已为全体幼儿提交寄语' : `已为 ${target.name} 提交寄语`,
      icon: 'none',
    });
  },

  onDotTap(e) {
    const { child, done } = e.currentTarget.dataset;
    if (done) {
      wx.navigateTo({ url: `/pages/teacher-message-detail/index?child=${child}` });
      return;
    }
    const i = TARGETS.findIndex((t) => t.key === child);
    const row = this.data.rows.find((r) => r.child === child);
    this.setData({ targetIndex: i > -1 ? i : 0, focusInput: true });
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    wx.showToast({ title: `请为 ${row.name} 填写寄语`, icon: 'none' });
  },
});
