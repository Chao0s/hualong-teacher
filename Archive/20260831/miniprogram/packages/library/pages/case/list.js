/**
 * 案例列表页 — APP-STRUCTURE.md screen id `CaseList`.
 *
 * 三个筛选维度，都是横排标签：年级（3 项）、五大领域（5 项）与活动形式（5 项）。
 * 判据在 docs/frontend spec files/form-control-spec.md §1，逐维走完三问：
 *   年级      第 2 问命中 —— 单选，3 ＋ 全部，取值固定。
 *   五大领域  第 2 问命中 —— 单选，5 ＋ 全部，取值固定。
 *   活动形式  第 1 问命中 —— `db_case.case_area` 是多选数组列；即使按第 2 问
 *             （契约的筛选参数是单值 enum，5 ＋ 全部）判，答案仍是标签。
 * **这一页因此一个滚轮也没有**，这是判据的结果，不是遗漏。
 *
 * 三行标签共 16 枚，但它们是**三行**，不是一行 16 枚：判据里那个「6」说的是一行放得下
 * 几枚，不是一屏放得下几枚。每行 6 枚以内不换行，三行竖排照样一眼看全。
 *
 * 换任一筛选走 `filters` 通道再 `loadFirst()`，旧游标因此被丢弃（§3.3：游标属于
 * 签发它的那一组筛选条件）。三个维度同时进 `filters`，所以组合筛选不需要额外代码。
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/library.js, so this file names no endpoint and formats nothing.
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');
const { createListMethods } = require('../../../../utils/list-page');

Page({
  data: {
    ready: false,
    gradeOptions: [],
    fieldOptions: [],
    areaOptions: [],
    // 空串即「全部」：buildQuery 丢掉空串，「不筛」就是不发这个参数。
    filters: { case_grade: '', case_field: '', case_area: '' },
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    this.setData({
      ready: true,
      gradeOptions: library.gradeFilters(),
      fieldOptions: library.fieldFilters(),
      areaOptions: library.areaFilters(),
      // 入口页可以带着一个领域进来。未带就是全部。
      filters: { case_grade: '', case_field: query.case_field || '', case_area: '' },
    });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /** Reaching the bottom is the only way more rows arrive. */
  onReachBottom() {
    this.loadMore();
  },

  ...createListMethods({ fetchPage: library.listCases }),

  /**
   * 换筛选就是换筛选集：旧游标作废，从头读一页。
   *
   * 三个维度共用这一个处理器，`field` 说的是改哪一维。先清空 items 是有用的：
   * `loadFirst` 失败时会保留原有的行，那些行属于上一组筛选条件，留在新标签下就是
   * 在骗人。
   */
  onFilterTap(e) {
    const { field, key } = e.currentTarget.dataset;
    if (this.data.filters[field] === key) return;
    this.setData({
      filters: { ...this.data.filters, [field]: key },
      items: [],
    });
    return this.loadFirst();
  },

  /**
   * 一行案例的去向有两个，按它的状态分（票据 15）：
   *
   *   草稿（s1）与已驳回（s4）  -> 上传表单，继续改自己的那一条
   *   其余                      -> 案例详情
   *
   * 这两态只可能出现在教师自己写的行上（可见范围 `case_status='s3' OR
   * created_by=$ctx_teacher`），所以这条分支不会把别人的案例带进编辑器。一条还没写完的
   * 草稿的「详情」是一页几乎空白的东西 —— 教师点它是想接着写，不是想读它。
   */
  onTap(e) {
    const { id, status } = e.currentTarget.dataset;
    if (status === 's1' || status === 's4') {
      library.openUpload('case', id);
      return;
    }
    wx.navigateTo({ url: `/packages/library/pages/case/detail?case_id=${id}` });
  },

  /** 上传案例。与首页「待上传」那条待办进的是同一张表单、同一条服务层写入路径。 */
  onUploadTap() {
    library.openUpload('case');
  },
});
