/**
 * 栏目版面编辑器 —— 原型 screens/growth-book-section-edit.html 的小程序版本。
 *
 * 网格几何、存档闸门（重叠 / 无来源 / 框太小 / 文字超容量）、比例套用、
 * 自动找空位，判断全部照搬，走 utils/growth-book.js 的同一套函数。
 *
 * 四处网页写法换成小程序写法：
 *   1. 画布用 px 不用 rpx —— 格子边长要精确正方，拖曳位移和触摸坐标要同一把尺；
 *   2. pointer 事件换成 touch 事件，拖到画布外不断线靠 catchtouchmove 挂在网格容器上；
 *   3. contenteditable + execCommand 换成 <editor> + EditorContext.format，
 *      存取用 delta（{insert, attributes:{bold,italic,color}}），和 run 阵列一一对应；
 *   4. location.href 换成 wx.navigateBack / wx.redirectTo：删除栏目退回编册页，
 *      发布征集与「已发布的栏目不再编辑版面」都改用 redirectTo，不留返回栈。
 *
 * 一处行为和原型不同：原型要求先选中文字才能套加粗／斜体／颜色，没选中就提示
 * 「先选取要套用的文字」。小程序读不到选区是否收合，这里直接交给 editor：
 * 有选区就套在选区上，没选区就套在接着输入的文字上。
 */

const {
  BINDING_KEYS,
  GRID,
  TEXT_COLORS,
  bindingOf,
  contentLength,
  contentRuns,
  contentText,
  overlapIds,
  textCapacity,
  widgetTooSmall,
  widgetsOverlap,
} = require('../../utils/growth-book.js');
const bookApi = require('../../services/growth-book.js');

/* 新建栏目的默认版面：两个图片征集槽与一个文字征集槽（F19 第四轮） */
function defaultWidgets() {
  const seed = `w${Date.now().toString(36)}`;
  return [
    { id: `${seed}-1`, page: 0, x: 0, y: 0, w: 7, h: 9, type: 'image', binding: 'collected', content: '', config: { fit: 'cover' } },
    { id: `${seed}-2`, page: 0, x: 8, y: 0, w: 7, h: 9, type: 'image', binding: 'collected', content: '', config: { fit: 'cover' } },
    { id: `${seed}-3`, page: 0, x: 0, y: 11, w: 15, h: 8, type: 'text', binding: 'collected', content: '', config: { size: 14, align: 'left' } },
  ];
}

/* 征集比例的快捷值：都是整数格数，比例逐像素成立（W1a / W9） */
const IMAGE_RATIOS = [{ w: 1, h: 1 }, { w: 4, h: 3 }, { w: 3, h: 4 }, { w: 3, h: 2 }, { w: 2, h: 3 }];
const SIZES = [10, 12, 14, 18, 24];
const ALIGNS = [{ v: 'left', icon: '左' }, { v: 'center', icon: '中' }, { v: 'right', icon: '右' }];
const FITS = [{ v: 'fill', label: '拉伸' }, { v: 'cover', label: '裁切填满' }, { v: 'crop', label: '自订裁切' }];

/* 画布几何：先算格子边长，两轴共用同一个整数像素（W1a）。BASE_W 是 best-fit 时的页宽。 */
const BASE_W = 340;
function geometry(zoom) {
  const pageW = Math.round(BASE_W * zoom);
  const cell = Math.floor(pageW * (1 - GRID.marginX * 2 / GRID.pageW) / GRID.cols);
  const contentW = cell * GRID.cols;
  const contentH = cell * GRID.rows;
  const padX = Math.round((pageW - contentW) / 2);
  /* 余数并入上下边距，页高由内容高 + 边距反推，保证格子精确正方 */
  const padY = Math.round(pageW * GRID.marginY / GRID.pageW);
  return { pageW, pageH: contentH + padY * 2, cell, padX, padY, contentW, contentH };
}

/* 占格数约分即比例：6×6 显示成 1:1、8×6 显示成 4:3 */
function ratioText(widget) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(widget.w, widget.h);
  return `${widget.w / g}:${widget.h / g}`;
}

/* 套用征集比例：取最接近当前面积的整数倍，必要时回推位置让它留在网格内 */
function setRatio(widget, text) {
  const [rw, rh] = text.split(':').map(Number);
  let k = Math.max(1, Math.round(Math.sqrt(widget.w * widget.h / (rw * rh))));
  k = Math.min(k, Math.floor(GRID.cols / rw), Math.floor(GRID.rows / rh));
  while (k > 1 && (rw * k < GRID.min || rh * k < GRID.min)) k -= 1;
  widget.w = Math.max(GRID.min, rw * k);
  widget.h = Math.max(GRID.min, rh * k);
  widget.x = Math.min(widget.x, GRID.cols - widget.w);
  widget.y = Math.min(widget.y, GRID.rows - widget.h);
}

function widgetLabel(widget) {
  const bind = bindingOf(widget.binding);
  const size = `${widget.w}×${widget.h}`;
  if (widget.type === 'text' && widget.binding === 'literal') {
    return `${contentText(widget.content) || '文字'} ${size}`;
  }
  return `${bind ? bind.name : '未设来源'} ${size}`;
}

/* run 阵列 ↔ editor 的 delta。原型是 contenteditable 的 DOM ↔ run 阵列。 */
function runsToDelta(content) {
  const runs = contentRuns(content);
  if (!runs.length) return { ops: [{ insert: '\n' }] };
  return {
    ops: runs.map((run) => {
      const attributes = {};
      if (run.b) attributes.bold = true;
      if (run.i) attributes.italic = true;
      if (run.c) attributes.color = run.c;
      return Object.keys(attributes).length ? { insert: run.t, attributes } : { insert: run.t };
    }),
  };
}

function deltaToRuns(delta) {
  const runs = [];
  ((delta && delta.ops) || []).forEach((op) => {
    if (typeof op.insert !== 'string' || !op.insert) return;
    const a = op.attributes || {};
    const run = { t: op.insert };
    if (a.bold) run.b = 1;
    if (a.italic) run.i = 1;
    if (a.color) run.c = a.color;
    const last = runs[runs.length - 1];
    if (last && last.b === run.b && last.i === run.i && last.c === run.c) last.t += run.t;
    else runs.push(run);
  });
  /* editor 的内容总以换行收尾，那一个不是教师打的，去掉 */
  const tail = runs[runs.length - 1];
  if (tail && tail.t.endsWith('\n')) tail.t = tail.t.slice(0, -1);
  return runs.filter((run) => run.t);
}

Page({
  data: {
    sectionName: '',
    anchorOptions: [],
    anchorIndex: 0,
    pageTabs: [],
    zoomLabel: '1.0×',
    geo: geometry(1),
    gridV: [],
    gridH: [],
    boxes: [],
    warns: [],
    metaCell: '',
    metaCount: '',
    drawer: null,
    locked: true,
    saveDisabled: true,
    delPageDisabled: true,
    deleteDisabled: true,
    layoutNote: '',
    loadError: '',
  },

  onLoad(options) {
    /* `?id=` 是 db_growth_book_section.section_id；`?new=1` 是还没建的那一个。 */
    this.sectionId = options.id ? String(options.id) : '';
    this.section = null;
    this.sections = [];
    this.widgets = [];
    this.pageCount = 1;
    this.page = 0;
    this.selected = null;
    this.zoom = 1;
    this.seq = 0;
    /* 取到编册状态之前一律不许写 —— 空的状态不等于「没有限制」。 */
    this.locked = true;
    this.anchorIds = [];
    this.anchorTypes = [];
    this.load();
  },

  /**
   * 取编册与本学期栏目清单。
   *
   * **已存的版面读不回来。** 契约里 `/teacher/growth-book/sections/{id}/widgets`
   * 只有 `PUT`，没有 `GET`（`db/GAPS.md` **G94** —— 栏目版面只写得进去、读不回来），
   * 所以按「保存手稿」会**整份覆盖**服务端已存的那一份。屏幕上有一行把这件事说出来。
   *
   * **所以已经存在的栏目从一张空画布开始，不从 `defaultWidgets()` 开始。**
   * 两个图片槽加一个文字槽是**新建栏目**的默认版面（decision.md 2026-08-13 第四轮），
   * 把它画给一个已经排过版的栏目，屏幕上那三个框既不是服务端存的那一份，
   * 也不是教师排的那一份 —— 它没有数据源（CLAUDE.md §8）。空画布至少是诚实的：
   * 这里什么都没有，因为读不回来。
   */
  async load() {
    let book;
    try {
      book = await bookApi.loadBookEdit();
    } catch (err) {
      this.setData({ loadError: bookApi.sectionFailureText(err), locked: true, saveDisabled: true });
      return;
    }
    const section = this.sectionId
      ? book.sections.find((item) => item.key === this.sectionId) || null
      : null;
    if (this.sectionId && !section) {
      this.setData({ loadError: '这个栏目不在本班本学期的编册里', locked: true, saveDisabled: true });
      return;
    }
    /* 已发布的栏目不再编辑版面，直接转去投稿管理（原型的 applyMode） */
    if (section && section.published) {
      wx.redirectTo({ url: `/pages/growth-book-section-materials/index?id=${section.key}` });
      return;
    }

    this.compilation = book.compilation;
    this.sections = book.sections;
    this.section = section;
    this.locked = book.compilation.locked;
    /* 新建的栏目给默认版面；已经存在的栏目给空画布 —— 见本函数头注。 */
    this.widgets = section ? [] : defaultWidgets();
    this.pageCount = 1;
    this.page = 0;
    this.selected = null;
    this.zoom = 1;
    this.seq = this.widgets.length;

    const anchors = bookApi.anchorChoices(book.sections, section && section.key);
    this.anchorIds = anchors.map((item) => item.id);
    this.anchorTypes = anchors.map((item) => item.type);
    const at = section ? this.anchorIds.indexOf(section.anchorAfter) : -1;

    wx.setNavigationBarTitle({ title: (section && section.name) || '新建栏目' });
    this.setData({
      loadError: '',
      sectionName: (section && section.name) || '',
      anchorOptions: anchors.map((item) => item.name),
      anchorIndex: at < 0 ? 0 : at,
      locked: this.locked,
      deleteDisabled: this.locked,
      layoutNote: this.locked
        ? '本学期编册已锁定，栏目版面不能再改。'
        : (section
          ? '这个栏目已存的版面读不回来（契约里 widgets 只有 PUT、没有 GET，缺口 G94），'
            + '所以画布是空的 —— 这里不画一份编出来的版面。'
            + '在这里排好之后按「保存手稿」，会用你排的这一份整份覆盖服务端已存的那一份。'
          : '版面存在服务端，整栏目一次提交、一次校验、一次存档；重叠或越界由服务端拒绝整份。'),
    });
    this.renderCanvas();
  },

  /* ---------- 画布 ---------- */

  renderCanvas() {
    const g = geometry(this.zoom);
    const bad = overlapIds(this.widgets);
    const collected = this.widgets.filter((w) => w.binding === 'collected').length;
    const cellPt = g.cell * 0.75;

    this.setData({
      geo: g,
      gridV: Array.from({ length: GRID.cols - 1 }, (_, i) => (i + 1) * g.cell),
      gridH: Array.from({ length: GRID.rows - 1 }, (_, j) => (j + 1) * g.cell),
      boxes: this.widgets.filter((w) => w.page === this.page).map((widget) => ({
        id: widget.id,
        isText: widget.type === 'text',
        sel: widget.id === this.selected,
        bad: bad.has(widget.id),
        left: widget.x * g.cell,
        top: widget.y * g.cell,
        width: widget.w * g.cell,
        height: widget.h * g.cell,
        label: widgetLabel(widget),
      })),
      zoomLabel: `${this.zoom.toFixed(1)}×`,
      pageTabs: Array.from({ length: this.pageCount }, (_, i) => ({ index: i, on: i === this.page })),
      delPageDisabled: this.locked || this.pageCount < 2,
      /* 44pt 是 iOS 建议的最小点击目标；best-fit 下一格不到 44pt，需放大才够 */
      metaCell: `一格 ${g.cell}px（${cellPt.toFixed(1)}pt）${cellPt < 44 ? ' · 放大到 2.4× 才达 44pt 触控标准' : ' · 已达 44pt 触控标准'}`,
      metaCount: `本栏目 ${this.pageCount} 页 · 共 ${this.widgets.length} 个组件 · 征集槽位 ${collected} 个`,
    });
    this.renderWarn(bad);
    this.renderDrawer();
  },

  /* 拖曳中只改位置与警告，不重建抽屉 —— 重建会把 editor 里的内容顶掉 */
  syncPositions() {
    const g = geometry(this.zoom);
    const bad = overlapIds(this.widgets);
    const boxes = this.data.boxes.map((box) => {
      const widget = this.widgets.find((w) => w.id === box.id);
      if (!widget) return box;
      return {
        ...box,
        bad: bad.has(widget.id),
        left: widget.x * g.cell,
        top: widget.y * g.cell,
        width: widget.w * g.cell,
        height: widget.h * g.cell,
        label: widgetLabel(widget),
      };
    });
    this.setData({ boxes });
    this.renderWarn(bad);
    this.syncDrawerSize();
  },

  /* 存档闸门：重叠、无来源、bound 型框太小、literal 超容量，任一成立都关掉保存 */
  renderWarn(bad) {
    const msgs = [];
    /* 空画布存不进去：服务端的 `at_least_one` 与本地的 whyCannotSaveWidgets 同一条。
       已经存在的栏目一进来就是空的，所以这一句要说出来，不能让保存键亮着却存不动。 */
    if (!this.widgets.length) msgs.push('画布是空的，至少放置一个组件才能保存。');
    if (bad.size) msgs.push(`有 ${bad.size} 个组件重叠（标红），请移开后再保存 —— 重叠一律拒绝放置，不做弹开推挤。`);
    const nobind = this.widgets.filter((w) => !w.binding);
    if (nobind.length) msgs.push(`有 ${nobind.length} 个组件未选内容来源。`);
    this.widgets.filter(widgetTooSmall).forEach((w) => {
      const bind = bindingOf(w.binding);
      msgs.push(`「${bind.name}」的框只能放 ${textCapacity(w)} 字，小于来源上限 ${bind.limit} 字，请放大或调小字级。`);
    });
    /* 打完字再把字级调大导致超出：挡住存档并提示，不可默默截断（W18） */
    this.widgets.filter((w) => w.binding === 'literal' && contentLength(w.content) > textCapacity(w)).forEach((w) => {
      msgs.push(`「${contentText(w.content).slice(0, 8)}…」已有 ${contentLength(w.content)} 字，超过当前字级下的容量 ${textCapacity(w)} 字，请调小字级或放大框。`);
    });
    this.setData({ warns: msgs, saveDisabled: this.locked || msgs.length > 0 });
  },

  onPickPage(e) {
    this.page = Number(e.currentTarget.dataset.index);
    this.selected = null;
    this.renderCanvas();
  },

  onAddPage() {
    if (this.locked) {
      wx.showToast({ title: '模板已永久定稿，不能修改', icon: 'none' });
      return;
    }
    this.pageCount += 1;
    this.page = this.pageCount - 1;
    this.selected = null;
    this.renderCanvas();
  },

  onDelPage() {
    if (this.data.delPageDisabled) return;
    this.widgets = this.widgets
      .filter((w) => w.page !== this.page)
      .map((w) => (w.page > this.page ? { ...w, page: w.page - 1 } : w));
    this.pageCount -= 1;
    this.page = Math.min(this.page, this.pageCount - 1);
    this.selected = null;
    this.renderCanvas();
  },

  onZoomIn() {
    this.zoom = Math.min(3, this.zoom + 0.4);
    this.renderCanvas();
  },

  onZoomOut() {
    this.zoom = Math.max(1, this.zoom - 0.4);
    this.renderCanvas();
  },

  /* ---------- 加组件 ---------- */

  freeSpot(w, h) {
    for (let y = 0; y + h <= GRID.rows; y += 1) {
      for (let x = 0; x + w <= GRID.cols; x += 1) {
        const box = { page: this.page, x, y, w, h };
        if (!this.widgets.some((other) => other.page === this.page && widgetsOverlap(other, box))) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  },

  addWidget(type) {
    if (this.locked) {
      wx.showToast({ title: '模板已永久定稿，不能修改', icon: 'none' });
      return;
    }
    const w = type === 'image' ? 6 : 13;
    const h = type === 'image' ? 6 : 4;
    const spot = this.freeSpot(w, h);
    this.seq += 1;
    const widget = {
      id: `${this.section.id}-w${this.seq}${Date.now().toString(36).slice(-3)}`,
      page: this.page, x: spot.x, y: spot.y, w, h, type,
      binding: type === 'image' ? 'collected' : 'literal',
      content: '',
      config: type === 'image' ? { fit: 'cover' } : { size: 14, align: 'left' },
    };
    this.widgets.push(widget);
    this.selected = widget.id;
    this.renderCanvas();
  },

  onAddImage() {
    this.addWidget('image');
  },

  onAddText() {
    this.addWidget('text');
  },

  /* ---------- 拖曳移动 / 右下把手缩放 ---------- */

  onAreaTouchStart() {
    if (!this.selected) return;
    this.selected = null;
    this.renderCanvas();
  },

  beginDrag(e, mode) {
    const { id } = e.currentTarget.dataset;
    const changed = this.selected !== id;
    this.selected = id;
    if (changed) this.renderCanvas();
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === id);
    const touch = e.touches[0];
    this.drag = {
      mode,
      cell: geometry(this.zoom).cell,
      sx: touch.pageX, sy: touch.pageY,
      ox: widget.x, oy: widget.y, ow: widget.w, oh: widget.h,
    };
  },

  onWidgetTouchStart(e) {
    this.beginDrag(e, 'move');
  },

  onHandleTouchStart(e) {
    this.beginDrag(e, 'resize');
  },

  onTouchMove(e) {
    if (!this.drag) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    const touch = e.touches[0];
    const dx = Math.round((touch.pageX - this.drag.sx) / this.drag.cell);
    const dy = Math.round((touch.pageY - this.drag.sy) / this.drag.cell);
    if (this.drag.mode === 'move') {
      widget.x = Math.max(0, Math.min(GRID.cols - widget.w, this.drag.ox + dx));
      widget.y = Math.max(0, Math.min(GRID.rows - widget.h, this.drag.oy + dy));
    } else {
      widget.w = Math.max(GRID.min, Math.min(GRID.cols - widget.x, this.drag.ow + dx));
      widget.h = Math.max(GRID.min, Math.min(GRID.rows - widget.y, this.drag.oh + dy));
    }
    this.syncPositions();
  },

  onTouchEnd() {
    if (!this.drag) return;
    this.drag = null;
    this.renderCanvas();
  },

  /* ---------- 属性抽屉 ---------- */

  drawerTitle(widget) {
    return `${widget.type === 'image' ? '图片组件' : '文字组件'} · ${widget.w} × ${widget.h} 格`
      + `（${widget.w * 10} × ${widget.h * 10}mm，比例 ${ratioText(widget)}）`;
  },

  capNote(widget) {
    const bind = bindingOf(widget.binding) || {};
    const literal = widget.type === 'text' && widget.binding === 'literal';
    return `本框可容 ${textCapacity(widget)} 字`
      + (literal ? ` · 已用 ${contentLength(widget.content)} 字（加粗/斜体/颜色不影响容量）` : '')
      + (bind.limit ? ` · 来源上限 ${bind.limit} 字` : '');
  },

  renderDrawer() {
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) {
      this.editorCtx = null;
      this.drawerWidgetId = null;
      this.setData({ drawer: null });
      return;
    }
    const bind = bindingOf(widget.binding) || {};
    const cfg = widget.config || {};
    const options = BINDING_KEYS.filter((item) => item.types.includes(widget.type));
    const isText = widget.type === 'text';
    const showLiteral = isText && widget.binding === 'literal';
    const size = cfg.size || 14;
    const sameWidget = this.drawerWidgetId === widget.id;

    if (!showLiteral) this.editorCtx = null;
    this.drawerWidgetId = widget.id;
    this.setData({
      drawer: {
        title: this.drawerTitle(widget),
        bindOptions: options,
        bindIndex: Math.max(0, options.findIndex((item) => item.key === widget.binding)),
        showLiteral,
        colors: TEXT_COLORS,
        boldOn: false,
        italicOn: false,
        sizeOptions: SIZES.map((n) => `${n}pt`),
        sizeIndex: Math.max(0, SIZES.indexOf(size)),
        size,
        aligns: ALIGNS,
        align: cfg.align || 'left',
        isText,
        capNote: this.capNote(widget),
        capBad: widgetTooSmall(widget),
        showRatio: widget.type === 'image' && widget.binding === 'collected',
        ratios: IMAGE_RATIOS.map((r) => ({ label: `${r.w}:${r.h}`, on: widget.w * r.h === widget.h * r.w })),
        ratioCap: `家长在手机上按 ${ratioText(widget)} 裁好才提交，进册后不会变形也不会被二次裁切，因此这里不需要设定显示方式。`,
        assessCap: !isText && widget.binding === 'child.assessment'
          ? `雷达图不是素材，是按题项分即时绘制的向量图，会自动填满 ${ratioText(widget)} 的框，无需设定显示方式。`
          : '',
        showFit: !isText && widget.binding !== 'child.assessment' && widget.binding !== 'collected',
        fits: FITS.map((f) => ({ ...f, on: (cfg.fit || 'cover') === f.v })),
        fitCap: `「${bind.name}」的照片不经成长册的裁剪工具，比例不定，需要指定对不上框时怎么放。`,
      },
    });
    /* 同一个 widget 不重灌 editor，否则打字打到一半会被自己顶掉 */
    if (showLiteral && this.editorCtx && !sameWidget) this.loadEditor(widget);
  },

  /* 拖曳中只回写尺寸相关的几项，不整块重建抽屉 */
  syncDrawerSize() {
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget || !this.data.drawer) return;
    this.setData({
      'drawer.title': this.drawerTitle(widget),
      'drawer.capNote': this.capNote(widget),
      'drawer.capBad': widgetTooSmall(widget),
      'drawer.ratios': IMAGE_RATIOS.map((r) => ({ label: `${r.w}:${r.h}`, on: widget.w * r.h === widget.h * r.w })),
    });
  },

  onBindChange(e) {
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    widget.binding = this.data.drawer.bindOptions[Number(e.detail.value)].key;
    if (widget.binding !== 'literal') widget.content = '';
    this.drawerWidgetId = null;
    this.renderCanvas();
  },

  onSizeChange(e) {
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    widget.config.size = SIZES[Number(e.detail.value)];
    this.renderCanvas();
  },

  onAlign(e) {
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    widget.config.align = e.currentTarget.dataset.align;
    this.renderCanvas();
  },

  onFit(e) {
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    widget.config.fit = e.currentTarget.dataset.fit;
    this.renderCanvas();
  },

  onRatio(e) {
    if (this.locked) return;
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    setRatio(widget, e.currentTarget.dataset.ratio);
    this.renderCanvas();
  },

  onDelWidget() {
    if (this.locked) return;
    this.widgets = this.widgets.filter((w) => w.id !== this.selected);
    this.selected = null;
    this.renderCanvas();
  },

  /* ---------- 教师自填文字 ---------- */

  onEditorReady() {
    wx.createSelectorQuery().in(this).select('#literalEditor').context((res) => {
      if (!res || !res.context) return;
      this.editorCtx = res.context;
      const widget = this.widgets.find((w) => w.id === this.selected);
      if (widget) this.loadEditor(widget);
    }).exec();
  },

  loadEditor(widget) {
    this.settingEditor = true;
    this.editorCtx.setContents({
      delta: runsToDelta(widget.content),
      complete: () => { this.settingEditor = false; },
    });
  },

  onEditorInput(e) {
    if (this.settingEditor) return;
    /* input 事件一般带 delta；没带就回头向 editor 问一次，别猜 */
    if (e.detail && e.detail.delta) this.applyLiteral(deltaToRuns(e.detail.delta));
    else this.readEditor();
  },

  applyLiteral(runs) {
    const widget = this.widgets.find((w) => w.id === this.selected);
    if (!widget) return;
    const cap = textCapacity(widget);
    /* 打满就打不下去：超出即还原到上一个合法状态（W18） */
    if (contentLength(runs) > cap) {
      this.loadEditor(widget);
      wx.showToast({ title: `已达本框上限 ${cap} 字`, icon: 'none' });
      return;
    }
    widget.content = runs;
    this.syncLiteral(widget);
  },

  onEditorStatus(e) {
    this.setData({ 'drawer.boldOn': !!e.detail.bold, 'drawer.italicOn': !!e.detail.italic });
  },

  /* 打字时不重建抽屉（会把内容顶掉），只回写资料并同步画布标签与字数 */
  syncLiteral(widget) {
    const i = this.data.boxes.findIndex((box) => box.id === widget.id);
    const patch = { 'drawer.capNote': this.capNote(widget) };
    if (i >= 0) patch[`boxes[${i}].label`] = widgetLabel(widget);
    this.setData(patch);
    this.renderWarn(overlapIds(this.widgets));
  },

  readEditor() {
    if (!this.editorCtx) return;
    this.editorCtx.getContents({ success: (res) => this.applyLiteral(deltaToRuns(res.delta)) });
  },

  onFormat(e) {
    if (this.locked || !this.editorCtx) return;
    this.editorCtx.format(e.currentTarget.dataset.cmd);
    this.readEditor();
  },

  onColor(e) {
    if (this.locked || !this.editorCtx) return;
    this.editorCtx.format('color', e.currentTarget.dataset.color);
    this.readEditor();
  },

  /* ---------- 栏目本身 ---------- */

  onNameInput(e) {
    this.setData({ sectionName: e.detail.value });
  },

  onAnchorChange(e) {
    this.setData({ anchorIndex: Number(e.detail.value) });
  },

  /**
   * 把栏目本身与整份版面写到服务端。**两发**：
   *
   *   `POST /sections`（还没建）或 `PATCH /sections/{id}`（已建，仅 d1）
   *   `PUT  /sections/{id}/widgets`（整栏目一次存档，仅 d1）
   *
   * 分两发不是绕路：契约把「栏目这一行」与「它的版面」分成两个动作
   * （`book_section.create`／`book_section.update` 与 `book_widget.save`），
   * 因为版面要整份校验、整份拒绝，而改个名字不该被一处重叠挡住。
   *
   * 第一发成功、第二发失败时栏目已经建出来了，名字与锚点是新的、版面还是旧的。
   * 那是一个真实存在的中间态：调用方照实说，页面重进后继续改。
   */
  async persist() {
    const name = this.data.sectionName.trim();
    const whyName = bookApi.whyCannotNameSection(
      name, this.sections, this.section && this.section.id,
    );
    if (whyName) {
      wx.showToast({ title: whyName, icon: 'none' });
      return null;
    }
    const whyWidgets = bookApi.whyCannotSaveWidgets(this.widgets);
    if (whyWidgets) {
      wx.showToast({ title: whyWidgets, icon: 'none' });
      return null;
    }
    const anchorAfter = this.anchorIds[this.data.anchorIndex] || 'time';
    const anchorType = this.anchorTypes[this.data.anchorIndex] || 'a2';
    const write = { name, anchorAfter, anchorType };

    const section = this.section
      ? await bookApi.updateSection(this.section.id, write)
      : await bookApi.createSection(write);
    this.section = section;
    this.sectionId = section.key;
    wx.setNavigationBarTitle({ title: section.name });

    const saved = await bookApi.saveWidgets(section.id, this.widgets);
    return { section, saved };
  },

  async onSave() {
    if (this.data.saveDisabled) return;
    this.setData({ saveDisabled: true });
    try {
      const done = await this.persist();
      if (done) wx.showToast({ title: `手稿已保存，${done.saved} 个组件`, icon: 'none' });
    } catch (err) {
      wx.showToast({ title: bookApi.sectionFailureText(err), icon: 'none' });
    }
    this.renderWarn(overlapIds(this.widgets));
  },

  /**
   * 删除栏目。草稿栏目直接执行，不经确认窗（F19 第五轮：宿主会拦截原生确认窗）。
   *
   * 服务端同事务删掉这一栏目的 widget 与已收提交（W16，不留孤儿档）。
   * 还没建到服务端的那一个（`?new=1` 且一次都没保存过）本来就没有行，直接退回。
   */
  async onDeleteSection() {
    if (this.data.deleteDisabled) {
      wx.showToast({ title: '本学期编册已锁定，栏目不能再删', icon: 'none' });
      return;
    }
    if (!this.section) {
      wx.navigateBack();
      return;
    }
    try {
      await bookApi.deleteSection(this.section.id);
    } catch (err) {
      wx.showToast({ title: bookApi.sectionFailureText(err), icon: 'none' });
      return;
    }
    wx.navigateBack();
  },

  /**
   * 发布征集 —— 三发：存栏目、存版面、`publishSection()`（发布 + 开始征集两条端点）。
   *
   * **发布即冻结**：d2 之后版面永久不能改，只能撤回征集，而撤回的语意是删除
   * （W16）。所以按下去之前问一次。
   */
  onPublish() {
    if (this.locked) {
      wx.showToast({ title: '本学期编册已锁定，栏目不能再发布', icon: 'none' });
      return;
    }
    if (!this.data.sectionName.trim()) {
      wx.showToast({ title: '请先填写栏目名称', icon: 'none' });
      return;
    }
    if (!this.widgets.some((w) => w.binding === 'collected')) {
      wx.showToast({ title: '至少放置一个家长征集槽位', icon: 'none' });
      return;
    }
    if (overlapIds(this.widgets).size || this.widgets.some(widgetTooSmall)) {
      wx.showToast({ title: '请先修正版面问题', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发布征集，版面永久冻结',
      content: '发布之后这个栏目的版面不能再改，家长立刻收到一则待办去交素材。'
        + '要改只能撤回征集，而撤回会把已收的素材一并删除。',
      confirmText: '确认发布',
      cancelText: '再想想',
      success: (res) => {
        if (res.confirm) this.publish();
      },
    });
  },

  async publish() {
    wx.showLoading({ title: '正在发布', mask: true });
    try {
      const done = await this.persist();
      if (!done) {
        wx.hideLoading();
        return;
      }
      await bookApi.publishSection(done.section.id);
      wx.hideLoading();
      wx.redirectTo({ url: `/pages/growth-book-section-materials/index?id=${done.section.key}` });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: bookApi.sectionFailureText(err), icon: 'none' });
    }
  },
});
