/**
 * 栏目版面 — APP-STRUCTURE.md screen id `BookSection`。
 *
 * 原型 `screens/growth-book-section-edit.html`。2026-08-27 补建：这一页此前整页没有，
 * 于是教师无处新建栏目，也无处排版面。不带编号进来就是新建（原型的 `?new=1`）。
 *
 * ── 三条契约铁律，这一页每一条都要守 ────────────────────────────────────────
 *
 * 1. **整栏目一次提交、一次校验、一次存档**（PUT，不是逐 widget PATCH）。任一处重叠则
 *    服务端拒绝**整个栏目**的存档。所以这里的红框与置灰只是体验，不是完整性边界 ——
 *    本地判定与服务端判定用的是同一份几何（`utils/layout.js`），但**服务端说了算**。
 * 2. **发布之后版面永久冻结**（W16）。d2 的栏目这一页只读：不给拖、不给缩、不给存。
 * 3. **网格是 15 × 24 格、最小 2 × 2 格**，widget 不得跨页、不得放进边距。这几个数不是
 *    这一页挑的，是 `utils/layout.js` 从 A4 与边距算出来的，与契约的 CHECK 逐条对得上。
 *
 * ── 拖拽与缩放 ──────────────────────────────────────────────────────────────
 *
 * 用 `movable-view` 拖动，右下角把手用触摸事件缩放。两者**落点都取整到格**：教师手指
 * 停在哪里不重要，存进去的必须是整数格坐标，否则服务端 422。
 */

const guard = require('../../../../utils/guard');
const growthBook = require('../../../../services/growth-book');
const layout = require('../../../../utils/layout');
const { reportFailure } = require('../../../../utils/present');

// 画布在屏上的宽度（rpx -> px 由平台换算，这里取一个固定的 px 目标宽度再按格分）。
const CANVAS_WIDTH_PX = 320;

/** 新增 widget 的默认大小：4 × 4 格，比最小的 2 × 2 好抓。 */
const NEW_W = 4;
const NEW_H = 4;

/**
 * 「内容从哪来」的登记键（契约 `binding_key`，W11）。
 *
 * 这一页只提供两个：`literal` 是教师自己打的标题，`parent.upload` 是向家长征集的图。
 * 别的绑定目标属于固定书脊，不由班级栏目产生。
 */
const BINDINGS = {
  text: 'literal',
  image: 'parent.upload',
};

/** `utils/layout.pageProblems` 的问题码翻成一句话。措辞在这里，规则在那边。 */
const PROBLEM_TEXT = {
  overlap: '有两个组件叠在一起了。同一页不能重叠，否则整个栏目存不进去。',
  min_size: `组件最小 ${layout.MIN_CELLS} × ${layout.MIN_CELLS} 格，再小就抓不住四角的把手。`,
  out_of_grid: '有组件出了网格。边距留给美术边框，组件不能放进去。',
  cross_page: '有组件不属于任何一页。版面单位是实体 A4 页，不是连续画布。',
  text_overflow: '文字框装不下它要显示的内容。放大框，或换一个更短的绑定。',
};

Page({
  data: {
    ready: false,
    loading: true,
    isNew: true,
    sectionId: 0,
    section: null,
    readonly: false,
    readonlyReason: '',

    name: '',
    anchorIndex: 0,
    anchors: [],

    // 版面。widget 存的是**格坐标**；`rect` 是给界面看的像素，不进请求体。
    widgets: [],
    pageIndex: 0,
    pageTabs: [],
    cellPx: 0,
    canvasWidth: 0,
    canvasHeight: 0,
    zoom: 1,

    // 本地重叠／越界判定的结果。服务端仍会独立复验（§6.4）。
    problems: [],
    notice: '',
    saving: false,
    publishing: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const sectionId = Number(query && query.section_id) || 0;
    const cellPx = Math.floor(CANVAS_WIDTH_PX / layout.COLS);
    this.setData({
      ready: true,
      isNew: !sectionId,
      sectionId,
      anchors: growthBook.SECTION_ANCHORS,
      cellPx,
      canvasWidth: cellPx * layout.COLS,
      canvasHeight: cellPx * layout.ROWS,
    });
    this.load();
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  /**
   * 读这一页要的两样：栏目本身与它的版面。
   *
   * 新建时两样都还不存在，所以直接进空白版面 —— 栏目要等第一次「保存手稿」才建出来。
   * 已有的栏目从清单里取（契约 v0.6.1 补的那条 GET；栏目没有单条读取端点）。
   */
  async load() {
    if (this.data.isNew) {
      this.setData({ loading: false, widgets: [], pageTabs: [0] });
      this.reflow();
      return;
    }
    try {
      const sections = await growthBook.listSections();
      const section = sections.find((s) => s.section_id === this.data.sectionId) || null;
      if (!section) {
        this.setData({ loading: false, errorText: '这个栏目不存在或不在可见范围内', errorCanRetry: false });
        return;
      }
      const anchorIndex = Math.max(0, growthBook.SECTION_ANCHORS
        .findIndex((a) => a.key === section.anchor_after));
      this.setData({
        loading: false,
        section,
        name: section.name,
        anchorIndex,
        // 发布之后版面永久冻结（W16）。这是唯一判据，页面不自己再算一遍。
        readonly: section.published,
        readonlyReason: section.published
          ? '这个栏目已发布，版面永久冻结，不能再改。'
          : '',
        widgets: (section.widgets || []).map((w) => ({ ...w })),
        pageTabs: this.tabsOf(section.widgets || []),
      });
      this.reflow();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 有几页。至少一页 —— 一个栏目不能零页。 */
  tabsOf(widgets) {
    const max = (widgets || []).reduce((n, w) => Math.max(n, Number(w.page_index) || 0), 0);
    return Array.from({ length: max + 1 }, (_, i) => i);
  },

  // ── 版面几何 ──────────────────────────────────────────────────────────────

  /**
   * 把格坐标摊成像素，并重跑一次本地判定。
   *
   * 判定用的是 `utils/layout.pageProblems` —— 与服务端同一套规则的客户端一份。
   * 它标红，但**不代表存得进去**：服务端会自己再跑一遍（契约 W6）。
   */
  reflow() {
    const cell = this.data.cellPx * this.data.zoom;
    const onPage = this.data.widgets.filter((w) => Number(w.page_index) === this.data.pageIndex);
    const widgets = this.data.widgets.map((w) => ({
      ...w,
      left: Math.round(Number(w.grid_x) * cell),
      top: Math.round(Number(w.grid_y) * cell),
      width: Math.round(Number(w.grid_w) * cell),
      height: Math.round(Number(w.grid_h) * cell),
      label: w.binding_key === BINDINGS.image
        ? `家长上传（征集） ${w.grid_w}×${w.grid_h}`
        : (w.content || '文字'),
    }));
    // `pageProblems` 回的是问题码，不是中文 —— 措辞归这一页，规则归 utils/layout。
    const problems = (layout.pageProblems(onPage) || []).map((p) => ({
      rule: p.rule,
      index: p.index,
      text: PROBLEM_TEXT[p.rule] || '这一页的版面有问题，服务端会拒绝存档。',
    }));
    // 标红哪几个：本地判定指名的那些下标（就这一页里的下标）。
    const bad = new Set(problems.map((p) => p.index));
    const pageIds = onPage.map((w) => this.data.widgets.indexOf(w));
    const flagged = new Set(Array.from(bad).map((i) => pageIds[i]));
    this.setData({
      widgets: widgets.map((w, i) => ({ ...w, bad: flagged.has(i) })),
      canvasWidth: Math.round(cell * layout.COLS),
      canvasHeight: Math.round(cell * layout.ROWS),
      problems,
    });
  },

  // ── 名称与位置 ────────────────────────────────────────────────────────────

  onNameInput(e) {
    this.setData({ name: e.detail.value, notice: '' });
  },

  onAnchorChange(e) {
    this.setData({ anchorIndex: Number(e.detail.value) });
  },

  // ── 页签 ──────────────────────────────────────────────────────────────────

  onPageTap(e) {
    this.setData({ pageIndex: Number(e.currentTarget.dataset.index) });
    this.reflow();
  },

  onAddPage() {
    if (this.data.readonly) return;
    const next = this.data.pageTabs.length;
    this.setData({ pageTabs: this.data.pageTabs.concat([next]), pageIndex: next });
    this.reflow();
  },

  /** 删页连同这一页上的 widget 一起删，后面的页号往前补 —— 页号必须连续。 */
  onDeletePage() {
    if (this.data.readonly) return;
    if (this.data.pageTabs.length <= 1) {
      this.setData({ notice: '一个栏目至少要有一页。' });
      return;
    }
    const gone = this.data.pageIndex;
    const widgets = this.data.widgets
      .filter((w) => Number(w.page_index) !== gone)
      .map((w) => (Number(w.page_index) > gone
        ? { ...w, page_index: Number(w.page_index) - 1 }
        : w));
    const tabs = this.data.pageTabs.slice(0, -1);
    this.setData({
      widgets,
      pageTabs: tabs,
      pageIndex: Math.min(gone, tabs.length - 1),
      notice: '',
    });
    this.reflow();
  },

  // ── 组件 ──────────────────────────────────────────────────────────────────

  onAddImage() {
    return this.addWidget('image');
  },

  onAddText() {
    return this.addWidget('text');
  },

  /**
   * 加一个 widget。放在第一个空得下的位置 —— 叠在别人身上会让整栏目存不进去。
   */
  addWidget(kind) {
    if (this.data.readonly) return;
    const spot = this.freeSpot();
    if (!spot) {
      this.setData({ notice: '这一页放不下了，换一页或先挪开一些组件。' });
      return;
    }
    const widget = {
      widget_id: 0,
      page_index: this.data.pageIndex,
      grid_x: spot.x,
      grid_y: spot.y,
      grid_w: NEW_W,
      grid_h: NEW_H,
      widget_type: kind,
      binding_key: BINDINGS[kind],
      content: kind === 'text' ? '' : null,
    };
    this.setData({ widgets: this.data.widgets.concat([widget]), notice: '' });
    this.reflow();
  },

  /** 从左上往右下找第一个放得下 NEW_W × NEW_H 的位置。 */
  freeSpot() {
    const onPage = this.data.widgets.filter((w) => Number(w.page_index) === this.data.pageIndex);
    const hits = (x, y) => onPage.some((w) => (
      x < Number(w.grid_x) + Number(w.grid_w)
      && Number(w.grid_x) < x + NEW_W
      && y < Number(w.grid_y) + Number(w.grid_h)
      && Number(w.grid_y) < y + NEW_H
    ));
    for (let y = 0; y + NEW_H <= layout.ROWS; y += 1) {
      for (let x = 0; x + NEW_W <= layout.COLS; x += 1) {
        if (!hits(x, y)) return { x, y };
      }
    }
    return null;
  },

  onRemoveWidget(e) {
    if (this.data.readonly) return;
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ widgets: this.data.widgets.filter((_, i) => i !== index), notice: '' });
    this.reflow();
  },

  onWidgetTextInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const widgets = this.data.widgets.map((w, i) => (i === index ? { ...w, content: e.detail.value } : w));
    this.setData({ widgets });
  },

  /**
   * 拖动落点。`movable-view` 给的是像素，这里**取整到格**再存 —— 手指停在哪里不重要，
   * 存进去的必须是整数格坐标，否则服务端 422。
   */
  onWidgetMoveEnd(e) {
    if (this.data.readonly) return;
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.cellPx * this.data.zoom;
    const w = this.data.widgets[index];
    if (!w) return;
    const x = this.clamp(Math.round(e.detail.x / cell), 0, layout.COLS - Number(w.grid_w));
    const y = this.clamp(Math.round(e.detail.y / cell), 0, layout.ROWS - Number(w.grid_h));
    this.patchWidget(index, { grid_x: x, grid_y: y });
  },

  /** 右下角把手。触摸移动量换算成格数增量，最小 2 × 2（契约与 layout 同一个数）。 */
  onResizeStart(e) {
    if (this.data.readonly) return;
    const index = Number(e.currentTarget.dataset.index);
    const touch = (e.touches || [])[0];
    if (!touch) return;
    this.resizing = {
      index,
      startX: touch.clientX,
      startY: touch.clientY,
      baseW: Number(this.data.widgets[index].grid_w),
      baseH: Number(this.data.widgets[index].grid_h),
    };
  },

  onResizeMove(e) {
    if (!this.resizing) return;
    const touch = (e.touches || [])[0];
    if (!touch) return;
    const cell = this.data.cellPx * this.data.zoom;
    const { index, startX, startY, baseW, baseH } = this.resizing;
    const w = this.data.widgets[index];
    if (!w) return;
    const gw = this.clamp(
      baseW + Math.round((touch.clientX - startX) / cell),
      layout.MIN_CELLS, layout.COLS - Number(w.grid_x),
    );
    const gh = this.clamp(
      baseH + Math.round((touch.clientY - startY) / cell),
      layout.MIN_CELLS, layout.ROWS - Number(w.grid_y),
    );
    this.patchWidget(index, { grid_w: gw, grid_h: gh });
  },

  onResizeEnd() {
    this.resizing = null;
  },

  patchWidget(index, patch) {
    const widgets = this.data.widgets.map((w, i) => (i === index ? { ...w, ...patch } : w));
    this.setData({ widgets, notice: '' });
    this.reflow();
  },

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  // ── 缩放 ──────────────────────────────────────────────────────────────────

  onZoomIn() {
    this.setZoom(Math.min(2.4, Math.round((this.data.zoom + 0.2) * 10) / 10));
  },

  onZoomOut() {
    this.setZoom(Math.max(0.6, Math.round((this.data.zoom - 0.2) * 10) / 10));
  },

  setZoom(zoom) {
    this.setData({ zoom });
    this.reflow();
  },

  // ── 保存与发布 ────────────────────────────────────────────────────────────

  /**
   * 保存手稿。
   *
   * 新建时先建栏目再存版面：两步同属一次逻辑尝试，所以幂等键生成一次、两步都带。
   * 本地判定拦不住的由服务端拦 —— 这里先问一遍只是为了少跑一趟。
   */
  async onSaveTap() {
    if (this.data.readonly || this.data.saving) return;
    const name = String(this.data.name || '').trim();
    if (!name) {
      this.setData({ notice: '栏目名称要填。' });
      return;
    }
    if (this.data.problems.length) {
      this.setData({ notice: '版面还有重叠或越界的组件，先调整再保存。' });
      return;
    }

    const anchor = this.data.anchors[this.data.anchorIndex] || this.data.anchors[0];
    const key = this.saveKey || growthBook.newAttemptKey();
    this.saveKey = key;
    this.setData({ saving: true, notice: '', errorText: '', errorRequestId: '', errorCanRetry: false });

    try {
      let sectionId = this.data.sectionId;
      if (!sectionId) {
        const made = await growthBook.createSection({
          name,
          anchorAfter: anchor.key,
          anchorType: anchor.anchor_type,
          idempotencyKey: key,
        });
        sectionId = made.section_id;
        this.setData({ sectionId, isNew: false, section: made });
      } else {
        await growthBook.updateSection({
          sectionId,
          name,
          anchorAfter: anchor.key,
          anchorType: anchor.anchor_type,
        });
      }
      await growthBook.saveWidgets({ sectionId, widgets: this.data.widgets });
      // 一次逻辑尝试结束，下一次保存是新的一次。
      this.saveKey = null;
      this.setData({ saving: false });
      wx.showToast({ title: '已保存', icon: 'none' });
    } catch (err) {
      this.saveKey = null;
      this.setData({ saving: false });
      reportFailure(this, err, {});
    }
  },

  /**
   * 发布征集。**版面从此永久冻结**（W16），所以按下去之前问一次。
   *
   * 契约的发布端点本轮没接：`book_section.publish` 在登记表里，但发布之后还牵着
   * 「征集开始／撤回／催办」三条，那是另一整块。这里先把话说清楚，缺口记在票据 27。
   */
  onPublishTap() {
    if (this.data.readonly || !this.data.sectionId) {
      this.setData({ notice: '先保存手稿，才能发布征集。' });
      return;
    }
    this.setData({
      notice: '「发布征集」还没有开放：发布会永久冻结版面，并牵出征集开始、撤回与催办三条流程，本轮先建版面这一段。',
    });
  },

  /** 删除栏目。同样是不可逆的，先问一次。 */
  onDeleteTap() {
    if (this.data.readonly || !this.data.sectionId) return;
    this.setData({
      notice: '「删除栏目」还没有开放：契约有这条动作，但删除牵动已勾选的编册与家长端征集，本轮先建版面这一段。',
    });
  },
});
