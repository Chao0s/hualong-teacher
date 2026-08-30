/**
 * 亲子时光管理 —— 原型 screens/growth-book-task-manage.html 的小程序版本。
 *
 * 每名幼儿进册的亲子活动存在 config.taskSelections[childId] 里，教师只能删不能加，
 * 加是在亲子任务那条线上做的。判定与存取都走 utils/growth-book.js。
 *
 * window.confirm 换成 wx.showModal，所以删除拆成两步。
 */

const {
  BOOK_CHILDREN,
  BOOK_TASKS,
  defaultTaskSelections,
  readBookConfig,
  writeBookConfig,
} = require('../../utils/growth-book.js');

Page({
  data: {
    children: [],
  },

  onLoad() {
    const config = readBookConfig();
    config.taskSelections = config.taskSelections || defaultTaskSelections();
    this.config = config;
    this.openChildId = null;
    this.render();
  },

  locked() {
    return this.config.compilationStatus === 'e2';
  },

  render() {
    const config = this.config;
    this.setData({
      children: BOOK_CHILDREN.map((child) => ({
        id: child.id,
        name: child.name,
        initial: child.name.slice(-1),
        open: this.openChildId === child.id,
        tasks: (config.taskSelections[child.id] || [])
          .map((id) => BOOK_TASKS.find((task) => task.id === id))
          .filter(Boolean),
      })),
    });
  },

  onToggleChild(e) {
    const { id } = e.currentTarget.dataset;
    this.openChildId = this.openChildId === id ? null : id;
    this.render();
  },

  onRemoveTask(e) {
    if (this.locked()) return;
    const { child: childId, task: taskId } = e.currentTarget.dataset;
    const task = BOOK_TASKS.find((item) => item.id === taskId);
    wx.showModal({
      content: `从这名幼儿的成长册中删除“${task.title}”？`,
      success: (res) => {
        if (!res.confirm) return;
        this.config.taskSelections[childId] =
          (this.config.taskSelections[childId] || []).filter((id) => id !== taskId);
        writeBookConfig(this.config);
        this.render();
        wx.showToast({ title: '已从该幼儿成长册删除', icon: 'none' });
      },
    });
  },
});
