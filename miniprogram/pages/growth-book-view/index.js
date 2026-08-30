/**
 * 成长册预览 —— 原型 screens/growth-book-view.html 的小程序版本。
 *
 * 看的是某一名幼儿的整本册子，?child= 指定是谁，缺省第一名。
 * 排页与翻页都走共用模块，本页只负责抬头那一条。
 */

const { BOOK_CHILDREN, bookChildPublished, readBookConfig } = require('../../utils/growth-book.js');
const viewer = require('../../utils/book-viewer.js');

Page({
  data: {
    childName: '',
    bookStatus: '',
    pages: [],
    pageIndex: 0,
    indicator: '1 / 1',
    atFirst: true,
    atLast: true,
  },

  onLoad(options) {
    const config = readBookConfig();
    const child = BOOK_CHILDREN.find((item) => item.id === options.child) || BOOK_CHILDREN[0];
    this.setData({
      childName: child.name,
      bookStatus: bookChildPublished(child, config) ? '已定稿' : '可预览',
    });
    viewer.load(this, child.name, config, false, child);
  },

  onPageTap(e) {
    viewer.tap(this, Number(e.currentTarget.dataset.index));
  },

  onPrev() {
    viewer.turn(this, -1);
  },

  onNext() {
    viewer.turn(this, 1);
  },
});
