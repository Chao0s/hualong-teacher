/**
 * 综合评估报告 — APP-STRUCTURE.md screen id `TermReport`（票据 20）。
 *
 * **只读页。** 量表、五维雷达图与两级评价（月度与学期）汇成一份整体判断，教师看，家庭
 * 之后在成长册里看到同样的一页。
 *
 * ── 没有导出、下载、分享 ─────────────────────────────────────────────────────
 *
 * DO-NOT-BUILD 3 与后端 F17：册子只存在于应用内，无 PDF、无图册、无 `wx.shareFileMessage`。
 * 这一页是册里那一栏的样子，所以同一条规矩照用：**页面上一个导出、下载、分享入口也没有，
 * 界面与文案里也不出现这些说法**。原型 `growth-comprehensive-assessment.html` 有一个
 * 「导出报告」弹层，那是 F17 之前的版本，不迁移。
 *
 * 契约那一侧同一条结论：雷达图**零存储** —— 不存图档、不存 base64、不开列，两端即时画。
 * 所以这一页也没有 `canvasToTempFilePath`、没有 `saveImageToPhotosAlbum`。
 *
 * ── 版式原语在这里第一次跑通 ─────────────────────────────────────────────────
 *
 * 票据 20 要求把成长册要用的版式原语（几何取整与像素取整的落点、栏目分块）在这里做出来。
 * 它们全在 `utils/layout`：
 *
 *   `assertGeometry()`      几何取整的落点 —— 210/297 减边距除得尽格数，余数 0，所以不取整
 *   `gridForPageWidth()`    像素取整的落点 —— `cell = floor(内容宽px / 15)`，两轴共用
 *   `layoutPage()`          栏目分块 —— 一栏目的 widget 按页分组，逐页映射成像素并校验
 *
 * **这一页的 widget 清单是它自己的一页，不是成长册的 composer。** 两者的区别是承重的：
 * 成长册的页序与页数由服务端 composer 解析（ADR-0013／§4 规则 93，预检、教师预览、定稿与
 * 家长查看共用同一个），客户端一页也不编；而这一页是教师端的一张报告，它就只有一页。
 * 共用的是**几何**，不是**编排**。
 *
 * ── 这一页不算分 ─────────────────────────────────────────────────────────────
 *
 * 五个轴的数值与取整全部来自票据 18 的 `radarModel`（服务层做过一次，一位小数四舍五入），
 * 齐备判定来自服务端的 `db_growth_record`（四列都是派生写入，客户端重算就会有第二个可能
 * 与服务端不一致的答案）。这一页一次算术也不做，除了几何。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const layout = require('../../../../utils/layout');
const { drawRadar } = require('../../../../utils/radar-canvas');
const { reportFailure } = require('../../../../utils/present');

/**
 * 正文字级，按格边长的比例给。
 *
 * `0.35 × 10mm = 3.5mm`，A4 上约 10pt —— 纪念册正文的常见字级。写成**比例**而不是一个
 * 像素数，是因为格边长随渲染面变（`cell = floor(内容宽px / 15)`），而「一个框放得下几个
 * 字」必须按真正渲染出来的字级算。页面把同一个 `fontPx` 既送进 `textCapacity` 也写进内联
 * 样式，两边因此不可能对不上。
 */
const BODY_FONT_RATIO = 0.35;

/**
 * 这一页的 widget 版面。格坐标，`grid_x ∈ 0..14`、`grid_y ∈ 0..23`，最小 2 × 2。
 *
 * 24 行排满：`2 + 2 + 10 + 4 + 6 = 24`。逐块通栏，两两不重叠 —— 重叠一律拒绝放置，
 * 不做弹开推挤（版式规格 §5.1）。
 *
 * `binding_key` 的取值来自 W11 的登记表：`literal` 是唯一内容真的存在 widget 列上的一种，
 * 其余都是指针。这一页全部是指针加两条 literal 标题。
 *
 * **学期综合评语不在这张纸上，这是算出来的结论不是排版偏好。** `db_term_eval.eval_text`
 * 的上限是 500 字，而 §6.5.2 对 bound 型 widget 的规则是「框必须大于等于该来源的字数
 * 上限」。按 `textCapacity` 反推：10pt 正文下 500 字要 15 × 22 格 —— 一页 24 行里的 22
 * 行，雷达图与领域分就都放不下了。所以评语在纸下面用一张普通卡片呈现，而成长册的
 * 「教师综合评估」那一栏必须给它**单独一页**。已记进交接。
 */
const WIDGETS = Object.freeze([
  Object.freeze({ key: 'title', binding_key: 'literal', widget_type: 'text', page_index: 0, grid_x: 0, grid_y: 0, grid_w: 15, grid_h: 2 }),
  Object.freeze({ key: 'meta', binding_key: 'literal', widget_type: 'text', page_index: 0, grid_x: 0, grid_y: 2, grid_w: 15, grid_h: 2 }),
  Object.freeze({ key: 'radar', binding_key: 'child.assessment', widget_type: 'image', page_index: 0, grid_x: 0, grid_y: 4, grid_w: 15, grid_h: 10 }),
  Object.freeze({ key: 'domains', binding_key: 'child.assessment', widget_type: 'text', page_index: 0, grid_x: 0, grid_y: 14, grid_w: 15, grid_h: 4 }),
  Object.freeze({ key: 'record', binding_key: 'child.record', widget_type: 'text', page_index: 0, grid_x: 0, grid_y: 18, grid_w: 15, grid_h: 6 }),
]);

Page({
  data: {
    ready: false,
    loading: true,

    // 名册。三页共用同一个来源，报告页也有幼儿选择器 —— 教师从入口页直接进来时还没有
    // 指定幼儿，那时候要能选一个，而不是看到一句「没有指定幼儿」。
    children: [],
    childId: 0,
    childValue: [],
    subtitle: '',

    radar: null,
    record: null,
    months: [],
    term: null,

    // 版面：每个 widget 带着它的像素矩形，外加这一页的问题清单。
    sheet: null,
    fontPx: 0,
    lineHeightPx: 0,
    problemTexts: [],

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    // 几何不变量。改动任何一个版式常数而忘了另一个，在这里当场炸，而不是等到某一页画歪。
    layout.assertGeometry();
    this.setData({ ready: true, childId: Number((query || {}).child_id) || 0 });
    return this.load();
  },

  async load() {
    try {
      const children = await evaluation.listChildren();
      this.setData({
        children: children.map((c) => ({ child_id: c.child_id, child_name: c.child_name })),
        childValue: this.data.childId ? [this.data.childId] : [],
      });
      if (!this.data.childId) {
        // 还没选幼儿不是错误，是这一页刚打开的样子。
        this.setData({ loading: false });
        return;
      }
      await this.loadReport();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onChildChange(e) {
    const childId = Number((e.detail.childIds || [])[0]) || 0;
    if (!childId || childId === this.data.childId) return;
    this.setData({
      childId, childValue: [childId], loading: true, errorText: '', errorCanRetry: false,
    });
    return this.loadReport();
  },

  async loadReport() {
    try {
      const report = await evaluation.report(this.data.childId);
      const radar = report.radar ? report.radar.radar : null;
      this.setData({
        loading: false,
        radar,
        record: report.record,
        months: report.months,
        term: report.term,
        subtitle: [
          report.record.child_name,
          radar ? radar.scale_label : '',
          radar ? radar.date_label : '',
        ].filter(Boolean).join(' · '),
      });
      await this.layoutSheet();
      await this.drawRadar();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /**
   * 量到纸的宽度，算出网格，把六个 widget 映射成像素矩形。
   *
   * 顺序是承重的：先量宽 -> `gridForPageWidth` 取整一次 -> `assertPageSurface` 确认这张
   * 渲染面真的是 A4 比例 -> 再映射。反过来（先按毫米换像素再铺格）每格会摊 0.06px 的误差，
   * 铺 24 行就是 1.4px 的累积漂移，格子不再是正方（版式规格 §2.2）。
   */
  async layoutSheet() {
    const size = await measureSize('#sheet');
    if (!size || !size.width) return;

    const grid = layout.gridForPageWidth(size.width);
    layout.assertPageSurface(grid);

    const fontPx = Math.max(9, Math.round(grid.cell * BODY_FONT_RATIO));
    const widgets = WIDGETS.map((w) => ({ ...w, text: this.textFor(w.key) }));
    const page = layout.layoutPage({ widgets, ordinal: 1, page_role: 'body', section_key: 'comp' }, grid, { fontPx });

    this.setData({
      sheet: {
        ...page,
        // 内容区相对纸面左上角的偏移。余数并入边距，所以内容区居中偏移用的是取整后的
        // 用量，不是原始的浮点内容宽。
        offsetLeft: grid.box.marginX + grid.remainderX / 2,
        offsetTop: grid.box.marginY + grid.remainderY / 2,
        width: grid.usedWidth,
        height: grid.usedHeight,
        cell: grid.cell,
      },
      fontPx,
      lineHeightPx: Math.round(fontPx * layout.LINE_HEIGHT),
      problemTexts: page.problems.map((p) => layout.problemText(p.rule)),
    });
  },

  /**
   * 每个 widget 的文字。**bound 型的内容来自既有记录**，literal 只有两条标题。
   *
   * 文字长度由服务端的列上限管着（`eval_text` 500 字），框的容量由 `utils/layout` 从格数与
   * 字级推导。两者对不上时 `layoutPage` 会给出 `text_exceeds_box`，页面就地说出来 ——
   * **不缩字、不裁切**：截断是最不能接受的失效方式（§6.5.3）。
   */
  textFor(key) {
    const d = this.data;
    if (key === 'title') return `${d.record ? d.record.child_name : ''} 综合评估报告`;
    if (key === 'meta') return d.subtitle;
    if (key === 'radar') return '';
    if (key === 'domains') {
      if (!d.radar) return '五大领域量表还没有结果。';
      return d.radar.axes.map((a) => `${a.name} ${a.value_label}`).join('　');
    }
    if (key === 'record') {
      if (!d.record) return '';
      return [
        d.record.month_label,
        `学期评价${d.record.term_done ? '已完成' : '未完成'}`,
        `五大领域量表${d.record.assessment_done ? '已完成' : '未完成'}`,
        d.record.record_label,
      ].join('\n');
    }
    return '';
  },

  /**
   * 在雷达图 widget 的框里画那张图。
   *
   * 绘图码是 `utils/radar-canvas` 里的那一份，与票据 18 的雷达图页共用 —— 两处各画一遍
   * 就会有两张画法可能不同的图。**五个轴齐了才画**：缺轴的多边形合不拢。
   */
  async drawRadar() {
    const radar = this.data.radar;
    if (!radar || !radar.can_draw) return;
    const hit = await measureCanvas('#report-radar');
    if (!hit) return;

    const canvas = hit.node;
    const width = hit.width;
    const height = hit.height;
    const ctx = canvas.getContext('2d');
    const dpr = pixelRatio();

    // 后备缓冲 = CSS 尺寸 × 像素比。设 width／height 会同时清空画布并复位变换矩阵，
    // 所以 scale 必须排在它们之后。
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    drawRadar(ctx, width, height, radar);
  },
});

/** 只量尺寸，不要节点 —— 纸不是画布，它是一个普通视图。 */
function measureSize(selector) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .select(selector)
      .fields({ size: true })
      .exec((res) => resolve((res && res[0]) || null));
  });
}

/** 量到画布节点。选择器落空回 null —— 空状态下画布根本没渲染，量不到是正常的。 */
function measureCanvas(selector) {
  return new Promise((resolve) => {
    wx.createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const hit = res && res[0];
        resolve(hit && hit.node ? hit : null);
      });
  });
}

/** 屏幕倍率。`getWindowInfo` 是 `getSystemInfo` 拆分后承接 `pixelRatio` 的那一个。 */
function pixelRatio() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return (info && info.pixelRatio) || 1;
}
