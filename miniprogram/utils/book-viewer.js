/**
 * 成长册翻页控制 —— 搬自原型 screens/growth-book-render.js 的 initBookViewer。
 *
 * 原版直接改 DOM 的 class 和 z-index，这里改成算好每页的 flipped / z 写进 data，
 * 由 templates/growth-book-page.wxml 渲染。规则一字未改：
 * 已翻过的页绕左边缘翻开并压低层级，未翻的页倒序堆叠。
 *
 * 样本页、单个幼儿查看页、学期编册页三页共用。
 */

const { buildBookPages } = require('./growth-book.js');

/* 原版的 sync()：逐页写 flipped 与 z-index，再回填页码与两个按钮的可用状态 */
function decorate(pages, index) {
  const total = pages.length;
  return pages.map((item, i) => ({
    ...item,
    index: i,
    flipped: i < index,
    z: i < index ? i : total - i,
  }));
}

function apply(page, pages, index) {
  page.setData({
    pages: decorate(pages, index),
    pageIndex: index,
    indicator: `${index + 1} / ${pages.length}`,
    atFirst: index === 0,
    atLast: index === pages.length - 1,
  });
}

/* keepPage 为真时停在原来那一页 —— 编册页改栏目后要就地重排 */
function load(page, name, config, keepPage, child) {
  const pages = buildBookPages(name, config, child);
  page.bookPages = pages;
  const index = keepPage ? Math.min(page.data.pageIndex || 0, pages.length - 1) : 0;
  apply(page, pages, index);
}

function turn(page, step) {
  const next = (page.data.pageIndex || 0) + step;
  if (next < 0 || next >= page.bookPages.length) return;
  apply(page, page.bookPages, next);
}

/* 点书页本身：已翻过的往回一页，其余往前一页 */
function tap(page, index) {
  turn(page, index < (page.data.pageIndex || 0) ? -1 : 1);
}

function reset(page) {
  apply(page, page.bookPages, 0);
}

module.exports = { load, turn, tap, reset };
