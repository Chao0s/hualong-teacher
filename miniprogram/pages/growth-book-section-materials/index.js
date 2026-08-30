/**
 * 栏目投稿管理 —— 原型 screens/growth-book-section-materials.html 的小程序版本。
 *
 * 栏目由 ?id= 指定，原型从 location.search 读，这里从 onLoad 的 options 读。
 * 齐备判定（交够全部 collected 槽位才算完成）走 utils/growth-book.js。
 *
 * 原型的 escapeText 只在拼 HTML 串时需要，wxml 不用，所以没搬。
 *
 * 一处比原型多的判断：没有 id 时 section 为空，「提醒家长」在原型里会报错。
 * 本批还没有页面能带着 id 跳进来，只能空着参数打开，所以这里挡掉。
 */

const {
  BOOK_CHILDREN,
  readBookConfig,
  sectionFilled,
  sectionSlots,
  sectionSubmission,
  writeBookConfig,
} = require('../../utils/growth-book.js');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' },
  { key: 'missing', label: '未提交' },
];

Page({
  data: {
    tabs: TABS,
    filter: 'all',
    doneCount: 0,
    totalCount: 0,
    visible: [],
    deleteDisabled: true,
  },

  onLoad(options) {
    const config = readBookConfig();
    this.config = config;
    this.section = (config.custom || []).find((item) => item.id === options.id);
    this.open = {};
    wx.setNavigationBarTitle({ title: this.section ? this.section.name : '栏目投稿' });
    this.render();
  },

  render() {
    const section = this.section;
    const records = BOOK_CHILDREN.map((child) => {
      const submission = section ? sectionSubmission(section, child.id) : null;
      const done = !!section && sectionFilled(section, child.id) >= sectionSlots(section);
      return {
        id: child.id,
        name: child.name,
        initial: child.name.slice(-1),
        done,
        open: !!this.open[child.id],
        images: ((submission && submission.images) || []).slice(0, 2),
        text: (submission && submission.text) || '',
      };
    });
    const filter = this.data.filter;
    this.setData({
      doneCount: records.filter((row) => row.done).length,
      totalCount: records.length,
      visible: records.filter((row) => filter === 'all'
        || (filter === 'done' ? row.done : !row.done)),
      deleteDisabled: !section || this.config.compilationStatus === 'e2',
    });
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    this.render();
  },

  onToggleDetail(e) {
    const row = this.data.visible[Number(e.currentTarget.dataset.index)];
    this.open[row.id] = !this.open[row.id];
    this.render();
  },

  onRemind(e) {
    const section = this.section;
    if (!section) return;
    const { id } = e.currentTarget.dataset;
    const child = BOOK_CHILDREN.find((item) => item.id === id);
    section.reminders = section.reminders || {};
    const previous = section.reminders[id] || { count: 0 };
    section.reminders[id] = { count: previous.count + 1, remindedAt: Date.now() };
    writeBookConfig(this.config);
    wx.showToast({ title: `已提醒${child ? child.name : ''}家长`, icon: 'none' });
  },

  onDeleteSection() {
    if (this.data.deleteDisabled) {
      if (this.config.compilationStatus === 'e2') wx.showToast({ title: '编册已经锁定', icon: 'none' });
      return;
    }
    const section = this.section;
    /* 锚定在这个栏目之后的，改锚到它自己的锚点上，不让它们凭空消失 */
    (this.config.custom || []).forEach((item) => {
      if (item.id !== section.id && item.after === section.id) item.after = section.after || 'time';
    });
    this.config.custom = (this.config.custom || []).filter((item) => item.id !== section.id);
    writeBookConfig(this.config);
    wx.navigateBack();
  },
});
