/**
 * 学期编册 — APP-STRUCTURE.md screen id `BookCompile`。
 *
 * 原型 `screens/growth-book-edit.html`，从成长册页的「编辑样板 ›」进来。2026-08-27 补建：
 * 这一页此前整页没有，于是成长册页上那条入口也没有，教师无处编排班级模板。
 *
 * ── 三件事，各有各的边界 ────────────────────────────────────────────────────
 *
 * **栏目勾选**走 `compilation.update`，带 `revision` 做 CAS（§5.1 三处之一）：带上读到的
 * 那一版，服务端比对不上就回 409，客户端**重读后再改**，绝不盲写覆盖同事的编排。
 *
 * **锁定编册**是 e1 -> e2，**单向**。它是逐幼儿 b1 -> b2 的前置：不锁定就没有一本册子
 * 定得了稿。锁了不能回头，所以按下去之前问一次。
 *
 * **实时预览**借的是成长册预览那条现成的路（manifest ＋ 逐页取图）。预览哪一名幼儿由
 * 名册第一位定 —— 原型上就是「陈小明」那一个固定样本，不是一个选择器。
 */

const guard = require('../../../../utils/guard');
const growthBook = require('../../../../services/growth-book');
const { reportFailure } = require('../../../../utils/present');

// 固定书脊里可勾选的只有这两个；term／comp／message 固定启用、不进开关、不得换序（F19）。
const TOGGLEABLE = ['time', 'task'];

Page({
  data: {
    ready: false,
    loading: true,

    compilation: null,
    rows: [],
    sections: [],

    // 实时预览。页码从 1 起，与原型的「1 / 14」一致。
    previewChildName: '',
    growthBookId: 0,
    page: null,
    ordinal: 1,
    totalPages: 0,
    previewNotice: '',

    saving: false,
    locking: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.load();
  },

  /** 从栏目版面返回时重读：新建的栏目要立刻出现在这一列里。 */
  onShow() {
    if (!this.entered) {
      this.entered = true;
      return;
    }
    return this.load();
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  async load() {
    try {
      const compilation = growthBook.decorateCompilation(await growthBook.ensureCompilation());
      const sections = await growthBook.listSections();
      this.setData({
        loading: false,
        compilation,
        sections,
        rows: this.buildRows(compilation, sections),
      });
      await this.loadPreview();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /**
   * 栏目管理那一列。
   *
   * `enabled_sections` 只存 time、task 与班级自订的 `section_id`，所以勾选态一律按
   * 字符串比对 —— 服务端存的就是字符串。
   */
  buildRows(compilation, sections) {
    const enabled = (compilation.enabled_sections || []).map(String);
    const fixed = growthBook.SOURCES
      .filter((s) => TOGGLEABLE.indexOf(s.key) !== -1)
      .map((s) => ({
        key: s.key,
        label: s.label,
        enabled: enabled.indexOf(s.key) !== -1,
        section_id: 0,
        // 原型上这两个各通往一个管理页（在园时光／亲子时光）。那两页本轮没建，
        // 所以这里先不给去处 —— 一个点了没反应的箭头比没有箭头更糟。票据 27。
        openable: false,
        state_label: '',
      }));
    const custom = sections.map((row) => ({
      key: String(row.section_id),
      label: row.name,
      enabled: enabled.indexOf(String(row.section_id)) !== -1,
      section_id: row.section_id,
      openable: true,
      // 发布之后版面永久冻结（W16），列上说一声，教师才知道点进去还能不能改。
      state_label: row.published ? `${row.status_label} · ${row.collection_label}` : row.status_label,
    }));
    return fixed.concat(custom);
  },

  // ── 栏目勾选 ──────────────────────────────────────────────────────────────

  async onToggle(e) {
    const { key } = e.currentTarget.dataset;
    const { compilation } = this.data;
    if (!compilation || compilation.locked || this.data.saving) return;

    const enabled = (compilation.enabled_sections || []).map(String);
    const next = enabled.indexOf(key) === -1
      ? enabled.concat([key])
      : enabled.filter((k) => k !== key);

    this.setData({ saving: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const row = growthBook.decorateCompilation(await growthBook.updateEnabledSections({
        compilationId: compilation.compilation_id,
        revision: compilation.revision,
        enabledSections: next,
      }));
      this.setData({
        saving: false,
        compilation: row,
        rows: this.buildRows(row, this.data.sections),
      });
      await this.loadPreview();
    } catch (err) {
      this.setData({ saving: false });
      // CAS 撞车：同事刚改过。重读一次再让教师决定，不盲写覆盖。
      if (err && err.code === 'revision_conflict') {
        wx.showToast({ title: '这份编册刚被改过，已为你重新读取', icon: 'none' });
        return this.load();
      }
      reportFailure(this, err, {});
    }
  },

  // ── 栏目版面 ──────────────────────────────────────────────────────────────

  onSectionTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    growthBook.openSection(Number(id));
  },

  /** 原型 `.sec` 右侧的「＋ 新建栏目」。锁定之后不给去处。 */
  onAddSectionTap() {
    if (this.data.compilation && this.data.compilation.locked) return;
    growthBook.openSection(0);
  },

  // ── 实时预览 ──────────────────────────────────────────────────────────────

  /**
   * 预览样本。原型固定看名册第一位，不是一个选择器。
   *
   * 版式包没发布时服务端回 `layout_pack_unreleased` —— 那不是故障，是「园所还没发布
   * 模板」，所以这里落成一行说明，不是错误横幅。原型那句提示逐字照抄。
   */
  async loadPreview() {
    try {
      const children = await growthBook.listChildren();
      const first = (children || [])[0];
      if (!first) {
        this.setData({ page: null, totalPages: 0, previewNotice: '本班名册里还没有幼儿，暂时预览不了。' });
        return;
      }
      const book = growthBook.decorateBook(await growthBook.ensureBook(first.child_id));
      const manifest = await growthBook.manifest(book.growth_book_id);
      this.setData({
        previewChildName: first.child_name,
        growthBookId: book.growth_book_id,
        totalPages: manifest.total_pages,
        previewNotice: '',
      });
      await this.loadPage(1);
    } catch (err) {
      const rule = err && err.details && err.details.rule;
      this.setData({
        page: null,
        totalPages: 0,
        previewNotice: rule === growthBook.PACK_UNRELEASED
          ? '模版尚未发布，只能预览；请先在编辑样板中完整预览并发布班级模板。'
          : '这一册暂时预览不了，请稍后再试。',
      });
    }
  },

  async loadPage(ordinal) {
    if (!this.data.growthBookId) return;
    try {
      const page = await growthBook.bookPage(this.data.growthBookId, ordinal, {});
      this.setData({ page, ordinal });
    } catch (err) {
      this.setData({ previewNotice: '这一页暂时读不出来。' });
    }
  },

  onPrevPage() {
    if (this.data.ordinal <= 1) return;
    return this.loadPage(this.data.ordinal - 1);
  },

  onNextPage() {
    if (this.data.ordinal >= this.data.totalPages) return;
    return this.loadPage(this.data.ordinal + 1);
  },

  // ── 锁定编册 ──────────────────────────────────────────────────────────────

  /** 锁定是**单向**的，所以按下去之前问一次。 */
  onLockTap() {
    const { compilation } = this.data;
    if (!compilation || compilation.locked || this.data.locking) return;
    wx.showModal({
      title: '锁定编册',
      content: '锁定之后班级模板不能再改，之后才能逐个幼儿定稿。确定锁定吗？',
      confirmText: '锁定',
      success: (res) => { if (res.confirm) this.doLock(); },
    });
  },

  /**
   * 幂等键按「一次逻辑尝试」生成一次并留在页面上：重复点击复用同一个，服务端按 §4.2
   * 回第一次的结果。
   */
  async doLock() {
    const { compilation } = this.data;
    const key = this.lockKey || growthBook.newAttemptKey();
    this.lockKey = key;
    this.setData({ locking: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const row = growthBook.decorateCompilation(await growthBook.lockCompilation({
        compilationId: compilation.compilation_id,
        revision: compilation.revision,
        idempotencyKey: key,
      }));
      this.setData({
        locking: false,
        compilation: row,
        rows: this.buildRows(row, this.data.sections),
      });
    } catch (err) {
      this.setData({ locking: false });
      reportFailure(this, err, {});
    }
  },
});
