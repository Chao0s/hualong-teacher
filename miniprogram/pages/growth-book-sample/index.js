/**
 * 成长册样本 —— 原型 screens/growth-book-sample.html 的小程序版本。
 *
 * 和预览页同一套排页，只是不带 child：幼儿名用「示例幼儿」，
 * 亲子时光取教师勾选的全班清单而不是某一名幼儿的选片。
 */

const { readBookConfig } = require('../../utils/growth-book.js');
const viewer = require('../../utils/book-viewer.js');

Page({
  data: {
    pages: [],
    pageIndex: 0,
    indicator: '1 / 1',
    atFirst: true,
    atLast: true,
  },

  onLoad() {
    viewer.load(this, '示例幼儿', readBookConfig(), false);
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

  onReset() {
    viewer.reset(this);
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/growth-book-edit/index' });
  },
});
