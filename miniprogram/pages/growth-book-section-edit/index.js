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
  bookAnchors,
  contentLength,
  contentRuns,
  contentText,
  overlapIds,
  readBookConfig,
  sectionWidgets,
  textCapacity,
  widgetTooSmall,
  widgetsOverlap,
  writeBookConfig,
} = require('../../utils/growth-book.js');

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
    locked: false,
    saveDisabled: false,
    delPageDisabled: true,
    deleteDisabled: false,
  },

  onLoad(options) {
    const config = readBookConfig();
    let section = (config.custom || []).find((item) => item.id === options.id);
    if (!section && options.new === '1') {
      const id = `cs${Date.now()}`;
      section = {
        id, name: '', after: 'time', pages: 1, submitted: {}, enabled: true,
        sectionStatus: 'd1', collectionStatus: 'c1',
        widgets: [
          { id: `${id}-w1`, page: 0, x: 0, y: 0, w: 7, h: 9, type: 'image', binding: 'collected', content: '', config: { fit: 'cover' } },
          { id: `${id}-w2`, page: 0, x: 8, y: 0, w: 7, h: 9, type: 'image', binding: 'collected', content: '', config: { fit: 'cover' } },
          { id: `${id}-w3`, page: 0, x: 0, y: 11, w: 15, h: 8, type: 'text', binding: 'collected', content: '', config: { size: 14, align: 'left' } },
        ],
      };
      config.custom = (config.custom || []).concat(section);
    }
    section = section || (config.custom || [])[0];

    /* 已发布的栏目不再编辑版面，直接转去投稿管理（原型的 applyMode） */
    if (section && section.sectionStatus === 'd2') {
      wx.redirectTo({ url: `/pages/growth-book-section-materials/index?id=${section.id}` });
      return;
    }

    this.config = config;
    this.section = section;
    this.locked = !section || config.compilationStatus === 'e2';
    this.widgets = JSON.parse(JSON.stringify(sectionWidgets(section)));
    this.pageCount = Math.max(1, (section && section.pages) || 1, ...this.widgets.map((w) => w.page + 1));
    this.page = 0;
    this.selected = null;
    this.zoom = 1;
    this.seq = this.widgets.length;

    const anchors = bookAnchors(config, section && section.id).filter((item) => item.id !== 'cover');
    this.anchorIds = anchors.map((item) => item.id);
    const at = this.anchorIds.indexOf(section && section.after);

    wx.setNavigationBarTitle({ title: (section && section.name) || '栏目版面' });
    this.setData({
      sectionName: (section && section.name) || '',
      anchorOptions: anchors.map((item) => item.name),
      anchorIndex: at < 0 ? 0 : at,
      locked: this.locked,
      deleteDisabled: config.compilationStatus === 'e2',
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

  persistSection(status) {
    let target = (this.config.custom || []).find((item) => item.id === this.section.id);
    if (!target) {
      target = this.section;
      this.config.custom = (this.config.custom || []).concat(target);
    }
    const name = this.data.sectionName.trim();
    if (!name) {
      wx.showToast({ title: '请先填写栏目名称', icon: 'none' });
      return null;
    }
    target.name = name;
    target.after = this.anchorIds[this.data.anchorIndex] || 'time';
    target.sectionStatus = status || target.sectionStatus || 'd1';
    target.collectionStatus = status === 'd2' ? 'c2' : (target.collectionStatus || 'c1');
    target.widgets = this.widgets;
    target.pages = this.pageCount;
    target.enabled = target.enabled !== false;
    this.section = target;
    writeBookConfig(this.config);
    wx.setNavigationBarTitle({ title: name });
    return target;
  },

  onSave() {
    if (this.data.saveDisabled) return;
    if (!this.persistSection('d1')) return;
    wx.showToast({ title: '手稿已保存', icon: 'none' });
  },

  onDeleteSection() {
    if (this.config.compilationStatus === 'e2') {
      wx.showToast({ title: '编册已经锁定', icon: 'none' });
      return;
    }
    const target = (this.config.custom || []).find((item) => item.id === this.section.id) || this.section;
    /* 锚定在这个栏目之后的，改锚到它自己的锚点上，不让它们凭空消失 */
    (this.config.custom || []).forEach((item) => {
      if (item.id !== target.id && item.after === target.id) item.after = target.after || 'time';
    });
    this.config.custom = (this.config.custom || []).filter((item) => item.id !== target.id);
    writeBookConfig(this.config);
    wx.navigateBack();
  },

  onPublish() {
    if (this.locked) {
      wx.showToast({ title: '栏目已经发布或编册已经锁定', icon: 'none' });
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
    if (!this.persistSection('d2')) return;
    wx.redirectTo({ url: `/pages/growth-book-section-materials/index?id=${this.section.id}` });
  },
});
