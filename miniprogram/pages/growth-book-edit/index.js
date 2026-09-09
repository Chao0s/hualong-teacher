/**
 * 2026 春季学期编册 —— 原型 screens/growth-book-edit.html 的小程序版本。
 *
 * 上半是一本册子的翻页预览，下半是栏目开关与「锁定编册」。
 *
 * ── 栏目开关写的是服务端那一列 ─────────────────────────────────────────────
 *
 * 勾选存在 `db_growth_book_compilation.enabled_sections`，走
 * `PATCH /teacher/growth-book/compilation/{compilation_id}`。那一条带 `revision`
 * 的 CAS（§5.1 三处之一）：同班另一位教师先改了，这一发回 409 `revision_stale`，
 * 页面照实说并重取，**不重试** —— 重试会把别人的勾选覆盖掉。
 *
 * 这一列只收 `'time'`、`'task'` 与班级 `section_id` 的字符串形式。教师综合评估、
 * 五大领域评估与学期寄语固定启用、不进开关、不得换序（F19），所以列表里没有它们；
 * 「预设必须存在的章节」那一行把整条固定书脊写出来，让教师知道它们在册子里。
 *
 * ── 「锁定编册」现在真的锁 ─────────────────────────────────────────────────
 *
 * `POST /teacher/growth-book/compilation/{compilation_id}/lock` 走 e1→e2，
 * **单向**，且是逐幼儿 b1→b2 的前置（F19 §五：这一层锁归教师）。
 * 锁定时服务端完整重验（§4 规则 96），任一项没过回 422 且一行不改。
 *
 * 页面在按下之前先做一次本地预检并把结果显示出来：未分节的在园活动笔数（问服务端，
 * 不数本机），以及已勾选却还是草稿的栏目个数。**本地预检不是校验** —— 服务端独立
 * 再验一次，本地这一份只是让教师少按一次注定被拒的按钮。
 *
 * ── 上方那个预览是版式样张，不是本班的正本 ────────────────────────────────
 *
 * 正本要 composer 解析 `GET /growth-book/books/{id}/manifest`，而 12 个版式包
 * 0 个 released，那条端点标着 `x-hualong-blocked-on`（与 `db/GAPS.md` **G93**
 * 阻在同一件事上）。所以这一块仍是本机的版式样张，**不随栏目勾选变化**，
 * 屏幕上有一行把这件事说出来。
 */

const { BOOK_CHILDREN, readBookConfig } = require('../../utils/growth-book.js');
const bookApi = require('../../services/growth-book.js');
const viewer = require('../../utils/book-viewer.js');

const PREVIEW_CHILD = BOOK_CHILDREN[0];

Page({
  data: {
    previewName: PREVIEW_CHILD.name,
    previewNote: '上方是版式样张，不是本班的正本：正本要 composer 解析 manifest，'
      + '而 12 个版式包 0 个已发布。它不随下方的勾选变化。',
    spineNote: bookApi.FIXED_SPINE_NOTE,
    sections: [],
    locked: false,
    lockLabel: '锁定编册',
    lockDisabled: true,
    pages: [],
    pageIndex: 0,
    indicator: '1 / 1',
    atFirst: true,
    atLast: true,
    /* 锁定按钮下面那一行。照实说这一页能做到什么、还差什么 */
    lockNote: '',
  },

  onShow() {
    /* 预览吃的是本机那份版式样张，与下方的勾选是两件事。 */
    viewer.load(this, PREVIEW_CHILD.name, readBookConfig(), false, PREVIEW_CHILD);
    this.load();
  },

  async load() {
    try {
      const book = await bookApi.loadBookEdit();
      this.book = book;
      this.setData({
        sections: book.rows,
        locked: book.compilation.locked,
        lockLabel: book.compilation.locked ? '已锁定' : '锁定编册',
        lockDisabled: book.compilation.locked,
      });
    } catch (err) {
      this.book = null;
      this.setData({
        sections: [],
        locked: false,
        lockLabel: '锁定编册',
        lockDisabled: true,
        lockNote: `读不到本班本学期的编册：${bookApi.sectionFailureText(err)}`,
      });
      return;
    }
    this.loadLockGate();
  },

  /**
   * 锁定前的两项本地预检。
   *
   * 未分节的在园活动笔数问服务端，不数本机那份：`loadTimeManage()` 取的就是
   * 在园时光管理页那一份，两页因此永远给同一个数。取不到就说取不到 ——
   * 把「读失败」显示成 0 会让这一页说「可以锁了」。
   */
  async loadLockGate() {
    let gate;
    try {
      const time = await bookApi.loadTimeManage();
      gate = `本学期还有 ${time.ungroupedCount} 项在园活动未分节。`;
    } catch (err) {
      gate = `未分节笔数读不到：${bookApi.actionFailureText(err)}`;
    }
    this.renderLockNote(gate);
  },

  renderLockNote(gate) {
    if (!this.book) return;
    if (this.book.compilation.locked) {
      this.setData({
        lockNote: '本学期编册已锁定（e2，单向）。栏目勾选、在园主题与栏目版面都不能再改，'
          + '现在可以到成长册首页逐册定稿。',
      });
      return;
    }
    const drafts = this.book.rows
      .filter((row) => row.custom && row.on && !row.published).length;
    const draftText = drafts ? `另有 ${drafts} 个已勾选栏目还没有发布。` : '';
    this.setData({
      lockNote: `锁定是单向的：锁上之后栏目勾选、在园主题与栏目版面都不能再改，`
        + `逐幼儿定稿才会打开。${gate}${draftText}`,
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

  async onToggleSection(e) {
    if (this.data.locked || !this.book) return;
    const row = this.data.sections[Number(e.currentTarget.dataset.index)];
    const on = !row.on;
    const enabled = this.data.sections
      .filter((item) => (item.key === row.key ? on : item.on))
      .map((item) => item.key);
    try {
      await bookApi.updateCompilation(this.book.compilation.id, this.book.compilation.revision, enabled);
    } catch (err) {
      wx.showToast({ title: bookApi.sectionFailureText(err), icon: 'none' });
      this.load();
      return;
    }
    await this.load();
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
    if (this.data.locked) return;
    wx.navigateTo({ url: '/pages/growth-book-section-edit/index?new=1' });
  },

  /* ---------- 锁定编册 ---------- */

  /**
   * e1→e2 单向。按下去之前问一次，把「锁上之后不能改什么」逐条写出来（§7.5）。
   */
  onLock() {
    if (!this.book) return;
    if (this.data.locked) {
      wx.showToast({ title: '本学期编册已经锁定', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '锁定编册，不可解锁',
      content: '锁定之后栏目勾选、在园主题、成长素材与栏目版面都不能再改，'
        + '本学期不提供解锁。锁定成功才能逐册定稿并向家长开放。',
      confirmText: '确认锁定',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.lock();
      },
    });
  },

  async lock() {
    wx.showLoading({ title: '正在锁定', mask: true });
    try {
      await bookApi.lockCompilation(this.book.compilation.id, this.book.compilation.revision);
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '没有锁定',
        content: `${bookApi.lockFailureText(err)}。服务端一行都没有改。`,
        showCancel: false,
      });
      this.load();
      return;
    }
    wx.hideLoading();
    await this.load();
    wx.showToast({ title: '编册已锁定', icon: 'none' });
  },
});
