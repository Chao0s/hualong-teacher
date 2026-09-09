/**
 * 成长册预览 —— 原型 screens/growth-book-view.html 的小程序版本。
 *
 * 看的是某一名幼儿的整本册子，`?child=` 是 `db_child.child_id`，缺省本班第一名。
 *
 * ── 这一页零写入 ───────────────────────────────────────────────────────────
 *
 * 预览页不建行。三条取数全是只读端点：
 *
 *   姓名   班级名册（`GET /home-school/moments/weekly-coverage` 派生）
 *   学期   会话上下文的 `current_term.term_name`（`GET /auth/session`）
 *   状态   `GET /teacher/growth-book/precheck` 的 `book_status`
 *
 * **不调 `POST /teacher/growth-book/compilation`。** 那一条是 NONE→e1 的建立，
 * 本学期还没有编册时它会真的建出一行来 —— 一页写着「预览」的屏幕打开一次就写一行库。
 * 本学期没有编册时预检回 409，抬头照实说一句，不替教师开册。
 *
 * ── 抬头是真的，翻的那本还不是 ─────────────────────────────────────────────
 *
 * `book_status` 是 `b1` 准备中／`b2` 已定稿；本学期还没有 `db_growth_book` 那一行时
 * 是「未建册」，那是一个事实，不是缺口。
 *
 * **下面翻的那一本仍是版式样张。** 正本要 composer 解析
 * `GET /growth-book/books/{growth_book_id}/manifest`，它与
 * `GET /growth-book/books/{id}/pages/{ordinal}` 都标着
 * `x-hualong-blocked-on: 0/12 released layout pack` —— 12 个版式包一个都没发布，
 * 没有 pack 可解析，页序、TOC 与每一页的内容今天都取不到。抬头下面有一行说明这件事。
 *
 * 班级名称没有落点：教师端没有回班名的端点，所以那一格不渲染（CLAUDE.md §8）。
 */

const { BOOK_CHILDREN, readBookConfig } = require('../../utils/growth-book.js');
const bookApi = require('../../services/growth-book.js');
const viewer = require('../../utils/book-viewer.js');

Page({
  data: {
    childName: '',
    termLabel: '',
    bookStatus: '',
    previewNote: '下面翻的是版式样张，不是这一本的正本：正本要 composer 解析 manifest，'
      + '而 12 个版式包 0 个已发布。',
    pages: [],
    pageIndex: 0,
    indicator: '1 / 1',
    atFirst: true,
    atLast: true,
  },

  onLoad(options) {
    /* 版式样张吃的是本机那份配置，与上面三格是两件事。 */
    viewer.load(this, BOOK_CHILDREN[0].name, readBookConfig(), false, BOOK_CHILDREN[0]);
    this.loadHead(options.child);
  },

  async loadHead(childId) {
    try {
      const head = await bookApi.loadChildBook(childId);
      this.setData({
        childName: head.name,
        termLabel: head.termLabel,
        bookStatus: head.statusLabel,
      });
    } catch (err) {
      this.setData({
        childName: '',
        termLabel: '',
        bookStatus: bookApi.bookFailureText(err),
      });
    }
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
