/**
 * 2026 春季学期编册 —— 原型 screens/growth-book-edit.html 的小程序版本。
 *
 * 上半是陈小明这一本的实时预览，下半是栏目开关。勾选口径照搬：
 *   预设栏目改 config.selected，新增栏目改自己的 enabled；
 *   改完就地重排预览并停在原来那一页（原版 render(true)）。
 *
 * 从栏目管理页返回要重算，onShow 里重读。
 *
 * ── 「锁定编册」这一颗按钮今天做不到，所以它只报告 ─────────────────────────
 *
 * 真的锁定走 `POST /teacher/growth-book/compilation/{compilation_id}/lock`，
 * 它要一个 `compilation_id`；`compilation_id` 又要先向
 * `POST /teacher/growth-book/compilation`（幂等的取回或建立）要，而那一条属成长册
 * 入口页那一步 —— **issue #27 接**。所以这一页锁不了。
 *
 * 锁不了就照实说，**不写 `compilationStatus`**（原来写一个本机 `e2` 并说「编册已锁定」）。
 * 一颗报告了并没有发生的锁定的按钮，比一颗按不下去的按钮更坏：服务端那一份仍是 `e1`，
 * 还可能挂着未分节的 `m1` 素材，于是这一页与在园时光管理页对同一个问题给出相反的答案。
 *
 * 未分节笔数也改问服务端（`loadLockGate`）。以前数的是 `config.material`，那个键在
 * `growth-book-time-manage`（在园时光管理）改读契约之后就没有写入者了 —— 新装的机器
 * 恒为空、数到 0 就放行，旧安装的机器留着 40 项没有 `topicId` 的旧数据、永远卡住。
 */

const {
  BOOK_CHILDREN,
  BOOK_ORDER,
  bookOutline,
  readBookConfig,
  writeBookConfig,
} = require('../../utils/growth-book.js');
const bookApi = require('../../services/growth-book.js');
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
    /* 锁定按钮下面那一行。照实说这一页能做到什么、还差什么 */
    lockNote: '',
  },

  onShow() {
    const config = readBookConfig();
    config.compilationStatus = config.compilationStatus || 'e1';
    this.config = config;
    this.ungroupedCount = null;
    this.gateError = '';
    this.render(true);
    this.loadLockGate();
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
    this.renderLockNote();
    viewer.load(this, PREVIEW_CHILD.name, this.config, keepPage, PREVIEW_CHILD);
  },

  /**
   * 未分节的在园活动有几项 —— 问服务端，不数本机那份。
   *
   * `loadTimeManage()` 取的就是在园时光管理页那一份，两页因此永远给同一个数。
   * 取不到就说取不到：把「读失败」显示成 0 会让这一页说「可以锁了」。
   */
  async loadLockGate() {
    try {
      const book = await bookApi.loadTimeManage();
      this.ungroupedCount = book.ungroupedCount;
      this.gateError = '';
    } catch (err) {
      this.ungroupedCount = null;
      this.gateError = bookApi.actionFailureText(err);
    }
    this.renderLockNote();
  },

  /** 把锁定按钮下面那一行写出来。三段：做不到、还差什么、去哪儿改。 */
  renderLockNote() {
    const drafts = (this.config.custom || [])
      .filter((item) => item.enabled !== false && item.sectionStatus !== 'd2').length;
    const gate = this.gateError ? `未分节笔数读不到：${this.gateError}`
      : this.ungroupedCount === null ? '正在读未分节的在园活动笔数。'
        : `本学期还有 ${this.ungroupedCount} 项在园活动未分节。`;
    const draftText = drafts ? `另有 ${drafts} 个已勾选栏目未发布。` : '';
    this.setData({
      lockNote: `锁定编册由服务端执行，这一页还接不上（issue #27 接通编册端点后才能锁）。${gate}${draftText}`,
    });
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

  /**
   * 这一颗按钮只报告，不锁。理由与去处写在文件头注：真的锁要 `compilation_id`，
   * 那一条端点属 issue #27。**这里绝不写 `compilationStatus`。**
   */
  onLock() {
    wx.showToast({ title: '这一页还不能锁定编册', icon: 'none' });
  },
});
