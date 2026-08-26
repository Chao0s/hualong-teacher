/**
 * 成长册版式原语 —— A4 页、15 × 24 网格、几何取整与像素取整。
 *
 * SOURCE OF TRUTH: `docs/frontend spec files/growth-book-layout-spec.md` §1 到 §7，
 * 它自己的权威是后端 `DECISIONS.md` E3 之下的 W1—W21。本文件**不新增、不放宽、不引申**，
 * 与那份规格冲突时以规格为准，与规格和 `DECISIONS.md` 都冲突时以 `DECISIONS.md` 为准。
 *
 * 票据 20 要求这批原语在综合评估报告页第一次做出来并跑通，票据 21 复用它 —— 所以它住在
 * `utils/` 而不是某一个服务模块里：`packages/evaluation` 与 `packages/growth-book` 是两个
 * 分包，分包规则只管 `services/`，两边都 require 得到这一份。**只有一份，就不会有两套。**
 *
 * ── 两个取整落点，为什么分开 ─────────────────────────────────────────────────
 *
 * 1. **几何取整（毫米）——余数为 0，所以这里根本不取整。**
 *    `210 − 30 × 2 = 150`，`150 ÷ 15 = 10.0`；`297 − 28.5 × 2 = 240`，`240 ÷ 24 = 10.0`。
 *    两轴共用 10mm 的格边长，余数 0（§1.2）。上下取 28.5 而不是 30 的理由在 §1.3：四边
 *    都 30mm 时内容区是 `150 × 237`，而 `150 : 237` 约分后分母 79 是质数，精确正方的唯一
 *    整除解是 3mm 的格子 —— 细到不能当占格单位。
 *    **落点是 `assertGeometry()`**：它把这些等式写成断言。改动任何一个常数而忘了另一个，
 *    在这里当场炸，而不是等到某一页画歪。
 *
 * 2. **像素取整（渲染面）—— 这里才真的取整，而且只取一次。**
 *    `cell = floor(内容宽px / 15)`，**两轴共用这一个整数**，`rows = floor(内容高px / cell)`，
 *    余数并入边距（§2.1）。分别拿宽和高去除格数会得到两个不同的浮点值，widget 的长宽比
 *    就不再是格数之比 —— 而家长端的裁剪框直接吃这个比值，且**没有原图可以重算**（§3.3）。
 *    所以精确正方不是美观问题，是正确性要求。
 *    **落点是 `pixelGrid()`**，全客户端只有这一处除法。
 *
 * ── 本文件刻意没有做的三件事 ─────────────────────────────────────────────────
 *
 *   排版      客户端**不排版**。ADR-0013／§4 规则 93：预检、教师预览、正式定稿与家长查看
 *             必须共用同一个 composer，而那个 composer 在服务端。客户端拿到的是
 *             `ResolvedBookManifest` 与逐页的 `BookPage`，本文件只把它们**映射成像素**并
 *             **校验**，一页也不自己编。规格 §11 附录把「近似页数公式」列为最大的两处差距
 *             之一，客户端补一份就是把那个差距搬进小程序。
 *   挑版式    §8 的重复页样板池与带种子的伪随机**不在这里**，因为 §10.1（末页不满怎么配）
 *             仍是开放项，而规格开头写着「实作时不得自选一种读法默默补上」。
 *   画图      §9.1 的「一份绘图码、两个环境」是为**导出 PDF** 设计的（canvas → JPEG →
 *             自组 PDF → `wx.shareFileMessage`）。F17 与 DO-NOT-BUILD 3 取消了导出、下载
 *             与分享，册子只存在应用内 —— 那条架构的前提没有了。所以页面用 WXML 定位盒子
 *             渲染，几何仍然全部来自本文件。已记进交接。
 */

class LayoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LayoutError';
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 几何（毫米）—— §1
// ══════════════════════════════════════════════════════════════════════════

/** A4 纵向。版面单位是**实体页**，不是连续画布（W1）。 */
const PAGE_MM = Object.freeze({ width: 210, height: 297 });

/** 左右 30、上下 28.5。边距是**有功能的区域**，要放得下美术边框（§1.4），不是余数。 */
const MARGIN_MM = Object.freeze({ x: 30, y: 28.5 });

const CONTENT_MM = Object.freeze({ width: 150, height: 240 });

const COLS = 15;
const ROWS = 24;
const CELL_MM = 10;

/** 最小 2 × 2 格（§4.1）：1 × 1 时四角缩放把手的触控热区会互相重叠。 */
const MIN_CELLS = 2;

/**
 * 整本硬上限 200 页（契约 `ResolvedBookManifest.total_pages` 的 `maximum: 200`，
 * 与 F17「整本没有页数下限，含固定页硬上限 200 页」）。
 *
 * 规格 §9.5 的「40 页 / 16MB 软上限」说的是 `wx.shareFileMessage` 的文件体积，那条路径
 * 已由 F17 取消，所以本客户端只认 200 这个硬上限。
 */
const PAGE_LIMIT = 200;

/**
 * 行高倍数。**这不是规格给的**。
 *
 * §6.5.1 只规定 `maxlength` 由 `grid_w × grid_h` 与当前字级即时推导，没有给行高；而不给
 * 行高就算不出「一个框放得下几行」。1.5 是中文正文的常见值，写在这里是为了让它**只有
 * 一处**、并且看得见它是客户端补的。已记进交接：要么规格补一个值，要么服务端把 `maxlength`
 * 一起下发。
 */
const LINE_HEIGHT = 1.5;

/**
 * 几何不变量。**这就是几何取整的落点** —— 余数为 0，所以不取整。
 *
 * 抛错而不是回真假：一个几何上不成立的网格没有降级形态可言，继续画只会画出错的东西。
 */
function assertGeometry() {
  const contentW = PAGE_MM.width - MARGIN_MM.x * 2;
  const contentH = PAGE_MM.height - MARGIN_MM.y * 2;
  if (contentW !== CONTENT_MM.width || contentH !== CONTENT_MM.height) {
    throw new LayoutError(
      `内容区与页面减边距对不上：${contentW} × ${contentH}，应为 `
      + `${CONTENT_MM.width} × ${CONTENT_MM.height}（版式规格 §1.2）。`
    );
  }
  if (contentW % COLS !== 0 || contentH % ROWS !== 0) {
    throw new LayoutError(
      `内容区除不尽格数，余数不为 0：${contentW} ÷ ${COLS}，${contentH} ÷ ${ROWS}（§1.2）。`
    );
  }
  if (contentW / COLS !== CELL_MM || contentH / ROWS !== CELL_MM) {
    throw new LayoutError(
      `两轴的格边长不同，格子不是精确正方（§3）：`
      + `${contentW / COLS}mm × ${contentH / ROWS}mm。`
    );
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════
// 像素（渲染面）—— §2
// ══════════════════════════════════════════════════════════════════════════

/**
 * 由页宽换算这一页的内容区尺寸。按 mm 比例缩放，**不取整** —— 取整发生在下一步，且只发生
 * 一次（§2.2：先把 10mm 换成像素再铺格，每格摊 0.06px 的误差，铺 24 行就漂 1.4px）。
 */
function contentBoxPx(pageWidthPx) {
  const scale = pageWidthPx / PAGE_MM.width;
  return {
    pageWidth: pageWidthPx,
    pageHeight: PAGE_MM.height * scale,
    marginX: MARGIN_MM.x * scale,
    marginY: MARGIN_MM.y * scale,
    width: CONTENT_MM.width * scale,
    height: CONTENT_MM.height * scale,
  };
}

/**
 * **像素取整的唯一落点。**
 *
 * ```
 * cell = floor(内容宽px / 15)        ← 只算一次，两轴共用这一个整数
 * rows = floor(内容高px / cell)
 * 余数 → 并入页边距（底部最多 cell − 1 px）
 * ```
 *
 * `rows` 的期望值恒为 24（§2.1.2）。不等于 24 表示渲染面比例不是 A4，那是**渲染面配置
 * 错误**，不得靠改网格迁就 —— 所以这里如实回报 `conforms`，由 `assertPageSurface` 决定
 * 要不要炸，而不是偷偷把 rows 改成 24。
 */
function pixelGrid(contentWidthPx, contentHeightPx) {
  const cell = Math.floor(contentWidthPx / COLS);
  if (!(cell >= 1)) {
    throw new LayoutError(`内容宽 ${contentWidthPx}px 不足 ${COLS} 个像素，铺不出网格。`);
  }
  const rows = Math.floor(contentHeightPx / cell);
  return {
    cell,
    cols: COLS,
    rows,
    usedWidth: cell * COLS,
    usedHeight: cell * rows,
    // 余数并入边距。横向最多 14px，纵向最多 cell − 1 px（§2.3 的工作示例：150 DPI 下是 1px）。
    remainderX: contentWidthPx - cell * COLS,
    remainderY: contentHeightPx - cell * rows,
    conforms: rows === ROWS,
  };
}

/** 渲染面必须是 A4 比例。`rows !== 24` 是配置错误，不是可以迁就的差异（§2.1.2）。 */
function assertPageSurface(grid) {
  if (!grid || grid.rows !== ROWS) {
    throw new LayoutError(
      `渲染面不是 A4 比例：算出 ${grid && grid.rows} 行，应为 ${ROWS} 行（§2.1.2）。`
      + '这是渲染面配置错误，不得靠改网格迁就。'
    );
  }
  return true;
}

/** 一页的网格，由页宽一步到位。页面只调这一个。 */
function gridForPageWidth(pageWidthPx) {
  const box = contentBoxPx(pageWidthPx);
  const grid = pixelGrid(box.width, box.height);
  return { ...grid, box };
}

/**
 * 一个 widget 的像素矩形，**相对内容区左上角**。
 *
 * 长宽比逐像素等于占格数之比，因为两轴共用同一个整数 `cell`（§3.1）。
 */
function widgetRect(widget, grid) {
  const w = widget || {};
  return {
    left: (w.grid_x || 0) * grid.cell,
    top: (w.grid_y || 0) * grid.cell,
    width: (w.grid_w || 0) * grid.cell,
    height: (w.grid_h || 0) * grid.cell,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 校验 —— §4.1、§5、§6.5
// ══════════════════════════════════════════════════════════════════════════

/** 两个矩形（按格数，不按像素）有没有重叠。 */
function overlaps(a, b) {
  return a.grid_x < b.grid_x + b.grid_w
    && b.grid_x < a.grid_x + a.grid_w
    && a.grid_y < b.grid_y + b.grid_h
    && b.grid_y < a.grid_y + a.grid_h;
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * 一页 widget 的版式问题。**回问题清单，不回真假。**
 *
 * `rule` 的取值逐字取自契约 `PUT /teacher/growth-book/sections/{id}/widgets` 的 422 说明
 * （`overlap` / `min_size` / `out_of_grid` / `cross_page` / `text_exceeds_box`），这样一条
 * 客户端发现的问题与服务端回的那一条能对上眼，教师看到的措辞也只有一套。
 *
 * **客户端的校验不是完整性边界**（§5.3）：服务端在存档时独立重跑同样的重叠检测，任一处
 * 重叠拒绝**整个栏目**。这里做它是为了两件事 —— 编辑时就地标红，以及渲染时拒绝画一页
 * 已经错了的版面（画出来的重叠比一句「这一页有问题」难懂得多）。
 *
 * @param {Array}  widgets 一页上的 widget，形状同契约的 `BookWidget`
 * @param {object} [opts]
 * @param {number} [opts.fontPx] 正文字级，给 `text_exceeds_box` 用；不给就不查这一条
 * @param {object} [opts.grid]   像素网格，同上
 */
function pageProblems(widgets, opts = {}) {
  const list = widgets || [];
  const out = [];

  list.forEach((w, index) => {
    if (!isNonNegativeInt(w.page_index)) {
      // widget 完整归属于单一页面（§1.1.2）。页号不是一个非负整数时，它归属于哪一页
      // 这件事本身就不成立 —— 那正是「跨页」在数据上的样子。
      out.push({ rule: 'cross_page', index, widget_id: w.widget_id || null });
    }
    if (!(w.grid_w >= MIN_CELLS) || !(w.grid_h >= MIN_CELLS)) {
      out.push({ rule: 'min_size', index, widget_id: w.widget_id || null });
    }
    if (
      !isNonNegativeInt(w.grid_x) || !isNonNegativeInt(w.grid_y)
      || w.grid_x + w.grid_w > COLS || w.grid_y + w.grid_h > ROWS
    ) {
      // widget 不得放进边距（§1.2.2）：网格只覆盖内容区。
      out.push({ rule: 'out_of_grid', index, widget_id: w.widget_id || null });
    }
    if (opts.fontPx && opts.grid && typeof w.text === 'string' && w.text.length > 0) {
      const capacity = textCapacity(w, opts.grid, opts.fontPx);
      if (w.text.length > capacity) {
        // 截断是最不能接受的失效方式（§6.5.3：家长拿到的纪念册里寄语写到一半断掉）。
        // 所以这里报问题，由页面说出来；页面不缩字、不裁切、也不让它溢出压住别的框。
        out.push({
          rule: 'text_exceeds_box', index, widget_id: w.widget_id || null, capacity,
        });
      }
    }
  });

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (overlaps(list[i], list[j])) {
        // 重叠一律拒绝，不做弹开推挤（§5.1）：小屏上的连锁位移教师看不懂发生了什么。
        out.push({ rule: 'overlap', index: j, with: i, widget_id: list[j].widget_id || null });
      }
    }
  }

  return out;
}

/**
 * 一个文字框放得下几个字。
 *
 * `每行字数 × 行数`，两者都向下取整。CJK 在常规体与粗体下同为定宽，所以粗／斜／色不改变
 * 换行，容量算得出来（§6.3.4）—— 这也正是「字级与对齐不逐段可改」的理由，不是偷懒。
 * 已登记的偏差：拉丁字母与数字在粗体下进阶宽度会变，中文文案不受影响。
 */
function textCapacity(widget, grid, fontPx) {
  const rect = widgetRect(widget, grid);
  const perLine = Math.floor(rect.width / fontPx);
  const lines = Math.floor(rect.height / (fontPx * LINE_HEIGHT));
  if (perLine < 1 || lines < 1) return 0;
  return perLine * lines;
}

// ══════════════════════════════════════════════════════════════════════════
// 栏目分块 —— §7.1
// ══════════════════════════════════════════════════════════════════════════

/**
 * 把一个栏目的 widget 按 `page_index` 分成一页一页。
 *
 * 一个栏目可含多页（§7.1.1），widget 归属 `section_id + page_index + grid_*`（§7.1.2）。
 * **分块只做分组，不决定页数** —— 页数是服务端 composer 解析 manifest 的结果（§4 规则 93），
 * 客户端数一数自己收到几页就是几页。
 *
 * 每一页顺带带上它自己的问题清单，页面因此不必再遍历一次，也不会漏掉某一页。
 */
function splitPages(widgets, opts = {}) {
  const byPage = new Map();
  (widgets || []).forEach((w) => {
    const key = isNonNegativeInt(w.page_index) ? w.page_index : -1;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(w);
  });
  return [...byPage.keys()]
    .sort((a, b) => a - b)
    .map((pageIndex) => ({
      page_index: pageIndex,
      widgets: byPage.get(pageIndex),
      problems: pageProblems(byPage.get(pageIndex), opts),
    }));
}

/**
 * 一页的可绑定形状：每个 widget 带上它的像素矩形，以及这一页的问题清单。
 *
 * WXML 直接绑 `rect`，页面不做第二次算术 —— 与 `services/assessment` 的取整规则同一条
 * 理由：算两次就会有两个答案。
 */
function layoutPage(page, grid, opts = {}) {
  // 两种来源，同一种形状。契约的 `BookWidget`（编辑器存的）带 `page_index`；`BookPage`
  // 的 `elements`（服务端已经分好页的）**不带** —— 它已经属于这一页了。补上页号而不是
  // 放宽校验：`cross_page` 那一条要能抓住「页号缺失」，就不能给它开一个「有时候可以没有」
  // 的口子。
  const source = (page && page.widgets) || (page && page.elements) || [];
  const widgets = (page && page.widgets)
    ? source
    : source.map((el) => ({ ...el, page_index: 0 }));
  const problems = pageProblems(widgets, { ...opts, grid });
  return {
    ordinal: (page && page.ordinal) || null,
    folio: (page && page.folio) === undefined ? null : page.folio,
    page_role: (page && page.page_role) || null,
    layout_code: (page && page.layout_code) || null,
    section_key: (page && page.section_key) || null,
    widgets: widgets.map((w, index) => ({ ...w, index, rect: widgetRect(w, grid) })),
    problems,
    // 有问题的一页**不画**。画出来的重叠比一句说明难懂，而且会让教师以为册子就长这样。
    drawable: problems.length === 0,
  };
}

/** 问题码的中文说法。一处措辞，页面与服务端的 `details.rule` 共用。 */
const PROBLEM_TEXT = {
  overlap: '同一页上有两个元素重叠',
  min_size: '有元素小于 2 × 2 格',
  out_of_grid: '有元素越出内容区，落进了边距',
  cross_page: '有元素没有归属到确定的一页',
  text_exceeds_box: '有一段文字超出它的框',
};

function problemText(rule) {
  return PROBLEM_TEXT[rule] || `版式问题：${rule}`;
}

module.exports = {
  LayoutError,
  PAGE_MM,
  MARGIN_MM,
  CONTENT_MM,
  COLS,
  ROWS,
  CELL_MM,
  MIN_CELLS,
  PAGE_LIMIT,
  LINE_HEIGHT,
  assertGeometry,
  contentBoxPx,
  pixelGrid,
  assertPageSurface,
  gridForPageWidth,
  widgetRect,
  pageProblems,
  textCapacity,
  splitPages,
  layoutPage,
  problemText,
};
