/**
 * 成长册 —— 原型 screens/growth-book.html 的小程序版本。
 *
 * 数据与判定全部走 utils/growth-book.js，一条口径都没有在本页重写。
 *
 * 两处网页写法换成小程序写法：
 *   1. window.confirm（跳过问题幼儿）换成 wx.showModal，所以定稿拆成两步；
 *   2. pageshow 换成 onShow —— 从编辑样板返回时要重算。
 */

const {
  BOOK_CHILDREN,
  BOOK_CLASS_LEVEL,
  BOOK_PAGE_LIMIT,
  COMPILATION_STATUS,
  bookCanFinalize,
  bookChildPublished,
  bookPageEstimate,
  bookPublished,
  bookSections,
  childSectionReady,
  classLevelReady,
  readBookConfig,
  sectionFilled,
  sectionSlots,
  writeBookConfig,
} = require('../../utils/growth-book.js');

/* 入口页只显示教师在编册管理面上勾选的栏目。 */
const childColumns = (config) => bookSections(config)
  .filter((section) => section.custom || section.key === 'time' || section.key === 'task');

function estimateText(config, child) {
  const est = bookPageEstimate(config, child);
  return `${est.pages} 页${est.over ? `（超过 ${BOOK_PAGE_LIMIT} 页）` : ''}`;
}

function childIssues(config, child) {
  const issues = [];
  bookSections(config).forEach((section) => {
    if (section.custom) {
      const item = (config.custom || []).find((entry) => entry.id === section.key);
      if (sectionFilled(item, child.id) < sectionSlots(item)) issues.push(`${section.name}缺素材`);
    } else if (BOOK_CLASS_LEVEL.includes(section.key)) {
      if (!classLevelReady(section.key, config)) issues.push(`${section.name}未就绪`);
    } else if (!childSectionReady(section.key, child, config)) {
      issues.push(`${section.name}未完成`);
    }
  });
  if (bookPageEstimate(config, child).over) issues.push(`超过 ${BOOK_PAGE_LIMIT} 页`);
  return issues;
}

Page({
  data: {
    sumTitle: '',
    sumList: '',
    tplState: '',
    published: false,
    progressNote: '',
    overall: 0,
    colNames: [],
    gridColumns: '',
    tableWidth: 640,
    rows: [],

    sheetOpen: false,
    sheetRows: [],
    allChecked: false,
    allDisabled: true,
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const config = readBookConfig();
    this.config = config;

    const cols = childColumns(config);
    const rows = BOOK_CHILDREN.map((child) => ({
      id: child.id,
      name: child.name,
      states: cols.map((section) => {
        /* 新增栏目：全部槽位交齐才算完成 */
        const item = section.custom && (config.custom || []).find((entry) => entry.id === section.key);
        const ok = section.custom
          ? sectionFilled(item, child.id) >= sectionSlots(item)
          : childSectionReady(section.key, child, config);
        return ok ? 'done' : 'miss';
      }),
    }));

    const publishedCount = BOOK_CHILDREN.filter((child) => bookChildPublished(child, config)).length;
    const ready = BOOK_CHILDREN
      .filter((child) => !bookChildPublished(child, config) && bookCanFinalize(child, config)).length;
    const total = bookSections(config).length;

    this.setData({
      sumTitle: `已收录 ${cols.length} 项内容`,
      sumList: cols.length
        ? cols.map((section) => section.name).join(' · ')
        : '尚未收录任何内容，点击进入编辑样板',
      tplState: COMPILATION_STATUS[config.compilationStatus] || '编册中',
      published: bookPublished(config),
      overall: Math.round(publishedCount / BOOK_CHILDREN.length * 100),
      progressNote: total
        ? `已开放 ${publishedCount}/${BOOK_CHILDREN.length} 本，另有 ${ready} 名幼儿可定稿`
        : '尚未收录任何内容，无法定稿成长册',
      colNames: cols.map((section) => section.name),
      /* 原型：minWidth = max(320, 120 + 列数 × 82) px，1px 记 2rpx */
      gridColumns: `240rpx repeat(${cols.length}, 1fr)`,
      tableWidth: Math.max(640, 240 + cols.length * 164),
      rows,
    });
  },

  onEditTemplate() {
    wx.navigateTo({ url: '/pages/growth-book-edit/index' });
  },

  onSample() {
    wx.navigateTo({ url: '/pages/growth-book-sample/index' });
  },

  /* ---------- 全班定稿：问题幼儿置灰，教师可明确跳过 ---------- */

  onOpenFinalize() {
    if (!this.data.published) return;
    const config = this.config;
    const sheetRows = BOOK_CHILDREN.map((child) => {
      const published = bookChildPublished(child, config);
      const ok = bookCanFinalize(child, config) && !published;
      const issues = childIssues(config, child);
      return {
        id: child.id,
        name: child.name,
        ok,
        checked: ok,
        desc: `${estimateText(config, child)} · ${published ? '已定稿开放' : (issues.join('；') || '内容齐备')}`,
      };
    });
    this.setData({ sheetOpen: true, sheetRows, ...this.selectAllState(sheetRows) });
  },

  onCloseFinalize() {
    this.setData({ sheetOpen: false });
  },

  /* 「全选」只在可选的行全部勾上时才亮；一个可选的行都没有时它自己也不可点。 */
  selectAllState(rows) {
    const list = rows.filter((row) => row.ok);
    return {
      allChecked: list.length > 0 && list.every((row) => row.checked),
      allDisabled: list.length === 0,
    };
  },

  onToggleAll() {
    if (this.data.allDisabled) return;
    const allChecked = !this.data.allChecked;
    const sheetRows = this.data.sheetRows.map((row) => (row.ok ? { ...row, checked: allChecked } : row));
    this.setData({ sheetRows, ...this.selectAllState(sheetRows) });
  },

  onToggleRow(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (!this.data.sheetRows[i].ok) return;
    const sheetRows = this.data.sheetRows
      .map((row, index) => (index === i ? { ...row, checked: !row.checked } : row));
    this.setData({ sheetRows, ...this.selectAllState(sheetRows) });
  },

  onConfirmFinalize() {
    const ids = this.data.sheetRows.filter((row) => row.ok && row.checked).map((row) => row.id);
    if (!ids.length) {
      wx.showToast({ title: '请至少选择 1 名幼儿', icon: 'none' });
      return;
    }
    const skipped = BOOK_CHILDREN
      .filter((child) => !bookChildPublished(child, this.config) && !ids.includes(child.id));
    if (!skipped.length) {
      this.finalize(ids);
      return;
    }
    wx.showModal({
      content: `将跳过 ${skipped.length} 名问题幼儿，所选 ${ids.length} 名定稿后永久锁定并向家长开放。确认继续？`,
      success: (res) => {
        if (res.confirm) this.finalize(ids);
      },
    });
  },

  finalize(ids) {
    const config = this.config;
    ids.forEach((id) => {
      if (!config.publishedChildren.includes(id)) config.publishedChildren.push(id);
    });
    writeBookConfig(config);
    this.setData({ sheetOpen: false });
    this.refresh();
    wx.showToast({ title: `已定稿并开放 ${ids.length} 本，通知已发给监护人`, icon: 'none' });
  },
});
