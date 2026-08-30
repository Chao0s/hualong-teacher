/**
 * 2026 春季学期编册 —— 原型 screens/growth-book-edit.html 的小程序版本。
 *
 * 上半是陈小明这一本的实时预览，下半是栏目开关。勾选口径照搬：
 *   预设栏目改 config.selected，新增栏目改自己的 enabled；
 *   改完就地重排预览并停在原来那一页（原版 render(true)）。
 *
 * 两处网页写法换成小程序写法：
 *   1. window.confirm（锁定编册）换成 wx.showModal，所以锁定拆成两步；
 *   2. 从栏目管理页返回要重算，onShow 里重读。
 */

const {
  BOOK_CHILDREN,
  BOOK_ORDER,
  bookOutline,
  readBookConfig,
  writeBookConfig,
} = require('../../utils/growth-book.js');
const viewer = require('../../utils/book-viewer.js');

const PREVIEW_CHILD = BOOK_CHILDREN[0];

/* 能在这一页管理的只有新增栏目和在园／亲子时光，其余三项不给开关 */
const manageableSections = (config) => bookOutline(config)
  .filter((item) => item.custom || item.key === 'time' || item.key === 'task');

Page({
  data: {
    previewName: PREVIEW_CHILD.name,
    sections: [],
    locked: false,
    pages: [],
    pageIndex: 0,
    indicator: '1 / 1',
    atFirst: true,
    atLast: true,
  },

  onShow() {
    const config = readBookConfig();
    config.compilationStatus = config.compilationStatus || 'e1';
    this.config = config;
    this.render(true);
  },

  locked() {
    return this.config.compilationStatus === 'e2';
  },

  render(keepPage) {
    this.setData({
      sections: manageableSections(this.config).map((item) => ({
        key: item.key,
        name: item.name,
        on: item.on,
        custom: !!item.custom,
        /* 已发布的新增栏目进投稿管理，还是手稿的进版面编辑器 */
        published: !!(item.custom && item.item && item.item.sectionStatus === 'd2'),
      })),
      locked: this.locked(),
    });
    viewer.load(this, PREVIEW_CHILD.name, this.config, keepPage, PREVIEW_CHILD);
  },

  /* ---------- 翻页 ---------- */

  onPageTap(e) {
    viewer.tap(this, Number(e.currentTarget.dataset.index));
  },

  onPrev() {
    viewer.turn(this, -1);
  },

  onNext() {
    viewer.turn(this, 1);
  },

  /* ---------- 栏目管理 ---------- */

  onToggleSection(e) {
    if (this.locked()) return;
    const row = this.data.sections[Number(e.currentTarget.dataset.index)];
    const on = !row.on;
    if (row.custom) {
      const section = (this.config.custom || []).find((item) => item.id === row.key);
      if (section) section.enabled = on;
    } else {
      const selected = new Set(this.config.selected || BOOK_ORDER);
      if (on) selected.add(row.key);
      else selected.delete(row.key);
      this.config.selected = BOOK_ORDER.filter((item) => selected.has(item));
    }
    writeBookConfig(this.config);
    this.render(true);
    wx.showToast({ title: on ? '栏目已加入成长册' : '栏目已从成长册隐藏', icon: 'none' });
  },

  onOpenSection(e) {
    const row = this.data.sections[Number(e.currentTarget.dataset.index)];
    if (row.custom) {
      wx.navigateTo({
        url: row.published
          ? `/pages/growth-book-section-materials/index?id=${row.key}`
          : `/pages/growth-book-section-edit/index?id=${row.key}`,
      });
      return;
    }
    wx.navigateTo({
      url: row.key === 'time'
        ? '/pages/growth-book-time-manage/index'
        : '/pages/growth-book-task-manage/index',
    });
  },

  onAddSection() {
    if (this.locked()) return;
    wx.navigateTo({ url: '/pages/growth-book-section-edit/index?new=1' });
  },

  /* ---------- 锁定编册 ---------- */

  onLock() {
    if (this.locked()) return;
    const config = this.config;
    const timeEnabled = (config.selected || []).includes('time');
    const ungrouped = timeEnabled ? (config.material || []).filter((item) => !item.topicId) : [];
    const drafts = (config.custom || [])
      .filter((item) => item.enabled !== false && item.sectionStatus !== 'd2');
    if (ungrouped.length) {
      wx.showToast({ title: `还有 ${ungrouped.length} 项在园活动未分节`, icon: 'none' });
      return;
    }
    if (drafts.length) {
      wx.showToast({ title: `还有 ${drafts.length} 个已勾选栏目未发布`, icon: 'none' });
      return;
    }
    wx.showModal({
      content: '锁定后本学期的栏目与入册内容不可再修改。确认锁定？',
      success: (res) => {
        if (!res.confirm) return;
        config.compilationStatus = 'e2';
        writeBookConfig(config);
        this.render(true);
        wx.showToast({ title: '编册已锁定', icon: 'none' });
      },
    });
  },
});
