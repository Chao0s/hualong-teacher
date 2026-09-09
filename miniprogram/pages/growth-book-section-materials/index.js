/**
 * 栏目投稿管理 —— 原型 screens/growth-book-section-materials.html 的小程序版本。
 *
 * 栏目由 `?id=` 指定，值是 `db_growth_book_section.section_id`；从编册页点已发布的
 * 栏目进来。整页要的数据在 `services/growth-book.js` 的 `loadSectionMaterials()` 里
 * 合成：编册、栏目清单、全班预检、班级名册。
 *
 * ── 投稿的正文与照片读不到，所以这一页不画它们 ─────────────────────────────
 *
 * 契约里回 `BookMaterialSubmission`（家长交给某个槽位的那一笔，含裁切成品与文字）
 * 的只有 `PUT /parent/growth-book/sections/{section_id}/submissions` —— 家长端的
 * 逐槽自动保存。**教师端一条都没有**，既读不到内容也拿不到 `submission_id`。
 * 与 `db/GAPS.md` **G70**（教师读不到任何一笔家长提交的内容，也拿不到它的 id）
 * 是同一族缺口。
 *
 * 所以原型的「查看」与展开后的照片、正文全部撤掉：没有数据源就不要渲染它
 * （CLAUDE.md §8）。这一页只说得出「这名幼儿交齐了没有」。
 *
 * ── 「交齐了没有」要两个条件同时成立才有 ───────────────────────────────────
 *
 * 那个结论由 `GET /teacher/growth-book/precheck` 产出，而预检有两道门：
 * 按 §4 规则 95 **只看 `enabled_sections` 里勾选了的栏目**，且只在这个栏目的
 * `collected` 槽位数大于 0 时才产出 `collected_incomplete`。任一条不成立时
 * 一条 problem 都不产生，那不是「全班都交齐了」，是没有结论。`judged` 为 false
 * 时页面照实说是哪一条挡住的，不把「没有结论」显示成「已完成」。
 *
 * ── 「删除栏目」在已发布的栏目上按不动 ─────────────────────────────────────
 *
 * `book_section.delete` 的 `from_state` 是 `d1`，契约写「d2 之后不可删除 —— 版面
 * 已冻结，且可能已有家庭提交（W16）」。这一页进得来的栏目都是 d2，所以那颗按钮
 * 一直是灰的，旁边写清为什么。原型的「删除时栏目、widget、投稿与引用一并删除」
 * 描述的是草稿栏目，那一颗在版面编辑页。
 */

const bookApi = require('../../services/growth-book.js');

/** 一发提醒之后照实说的那一句。三种情形分开，不把「零通知」说成「已发出」。 */
function remindText(result) {
  const notifications = result.notificationCount;
  const children = result.childCount;
  if (notifications === null) return '已发出提醒（服务端未回条数）';
  if (notifications === 0) {
    return children === 0
      ? '这名幼儿没有登记监护人，没有发出通知'
      : '没有发出通知：这名幼儿已经交齐，或栏目没有在征集';
  }
  return `已通知 ${children} 名幼儿的监护人，共 ${notifications} 条`;
}

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已交齐' },
  { key: 'missing', label: '未交齐' },
];

Page({
  data: {
    tabs: TABS,
    filter: 'all',
    doneCount: 0,
    totalCount: 0,
    judged: true,
    judgeNote: '',
    visible: [],
    deleteDisabled: true,
    deleteNote: '',
    loadError: '',
  },

  onLoad(options) {
    this.sectionId = options.id || '';
  },

  onShow() {
    this.load();
  },

  async load() {
    if (!this.sectionId) {
      this.setData({ loadError: '没有指定栏目，请从编册页点栏目进来', visible: [] });
      return;
    }
    let page;
    try {
      page = await bookApi.loadSectionMaterials(this.sectionId);
    } catch (err) {
      this.page = null;
      this.setData({ loadError: bookApi.sectionFailureText(err), visible: [] });
      return;
    }
    if (!page.section) {
      this.page = null;
      this.setData({ loadError: '这个栏目不在本班本学期的编册里', visible: [] });
      return;
    }
    this.page = page;
    wx.setNavigationBarTitle({ title: page.section.name });
    this.render();
  },

  render() {
    const page = this.page;
    const filter = this.data.filter;
    const rows = page.rows.filter((row) => filter === 'all'
      || (filter === 'done' ? row.done : !row.done));
    this.setData({
      loadError: '',
      doneCount: page.doneCount,
      totalCount: page.totalCount,
      judged: page.judged,
      judgeNote: page.judgeNote,
      visible: rows,
      deleteDisabled: true,
      /* 两条前置各说各的：`book_section.delete` 的 from_state 是 d1，
         precondition 是 compilation_status=e1。哪一条挡住就说哪一条，
         不把没有查过的那一条当成理由。 */
      deleteNote: page.section.published
        ? '栏目已发布，版面永久冻结，服务端不接受删除；草稿栏目才可以删。'
        : (page.compilation.locked
          ? '本学期编册已锁定，栏目不能再删。'
          : '这个栏目还是草稿，删除按钮在栏目版面编辑页。'),
    });
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.key });
    if (this.page) this.render();
  },

  /**
   * 提醒家长补交（建 `n4`）。
   *
   * 幂等键由 `utils/request.js` 自动补（登记表 `section.remind` 是 `required`）；
   * 教师再次明确点击会产生新一轮通知，那是规则 99 允许的，不是重复发送。
   *
   * **只提醒按下的那一行。** 送出去的 `child_ids` 就是这一名幼儿，服务端把它内联
   * 进 WHERE（登记表 `section.remind` 的 `child_scope_inline`）。
   *
   * 条数照服务端回的两个数说：`notified_child_count` 是提醒到的幼儿数，
   * `notification_count` 是建出来的通知笔数（一名幼儿有几名监护人就几笔）。
   * 两个数都是 0 时说「这名幼儿没有登记监护人」——「零 caretaker 合法零通知」
   * （§4 规则 99），那不是失败，也不是「已发出」。取不到就不编一个数。
   */
  async onRemind(e) {
    const id = Number(e.currentTarget.dataset.id);
    try {
      const result = await bookApi.remindSection(this.sectionId, [id]);
      wx.showToast({ title: remindText(result), icon: 'none' });
    } catch (err) {
      wx.showToast({ title: bookApi.sectionFailureText(err), icon: 'none' });
    }
  },

  onDeleteSection() {
    wx.showToast({ title: this.data.deleteNote, icon: 'none' });
  },
});
