/**
 * 成长册预览 — APP-STRUCTURE.md screen id `BookPreview`（票据 21）。
 *
 * 教师从头翻到尾，看完再做一次确认，这本册子才定稿。**确认在这一页**，理由写在
 * `pages/create/index.js` 的头注里：完整预览这件事只有预览页见证得到。
 *
 * ── 预览与家庭看到的是同一份 ─────────────────────────────────────────────────
 *
 * 读的是 `GET /growth-book/books/{id}/manifest` 与 `GET .../pages/{ordinal}` —— **没有
 * `/teacher/` 前缀**，契约给它们的角色是 `[teacher, parent]`，家长端读的就是这两条。
 * ADR-0013／§4 规则 93：预检、教师预览、正式定稿与家长查看**共用同一个 composer**，禁止
 * 近似页数公式。所以这一页一页也不自己编、一行页数也不自己算，只把服务端给的格坐标交给
 * `utils/layout` 映射成像素。这就是「预览呈现的内容与版式，与家庭端最终看到的成长册一致」
 * 在代码上的样子：不是两份实现凑得很像，是同一份。
 *
 * ── 没有一份版式包发布的时候 ─────────────────────────────────────────────────
 *
 * 那两条路径在契约上都带着 `x-hualong-blocked-on: "0/12 released layout pack"`
 * （ADR-0015 Follow-ups）。**这是当前的事实，不是异常路径。** 服务端在这种情形下回 409
 * 加 `details.rule = 'layout_pack_unreleased'`，`services/growth-book.manifest()` 把它翻译
 * 成一种**状态**，这一页据此：
 *
 *   显示一句说明，说清楚缺的是什么、由谁补、补上之后会看到什么；
 *   **不画空白页**（教师会以为册子就长这样）；
 *   **不编一份版面**（那会违反上面那条「共用同一个 composer」）；
 *   **不弹错误**（一件已知的、有确定完成条件的待办不是服务故障）；
 *   **关掉确认生成** —— 没有完整预览就没有 `HUMAN_PREVIEW_CONFIRM` 的前置，这一条本来
 *   就该关。降级因此不是绕过闸门，恰恰是闸门在正常工作。
 *
 * ── 有问题的一页不画 ─────────────────────────────────────────────────────────
 *
 * 每一页拿回来都过一次 `utils/layout` 的校验：越界、小于 2 × 2、重叠、文字超框各有一条
 * 规则，规则名与服务端存档时回的 `details.rule` 逐字相同。有问题就说出来是哪一条 ——
 * 把重叠画出来比说一句话难懂得多，而且会让教师以为册子本来就长这样。
 *
 * ── 不得建造 ─────────────────────────────────────────────────────────────────
 *
 * DO-NOT-BUILD 3：没有导出、下载、分享入口，界面与文案里也不出现这些说法。定稿本身
 * 「不生成任何文件、不签发下载链接」（F17），所以确认成功之后也没有第二步。
 */

const guard = require('../../../../utils/guard');
const growthBook = require('../../../../services/growth-book');
const layout = require('../../../../utils/layout');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * **两条，因为一本册子同时携带两类内容**：教师写的字（寄语、月度与学期评价）走
 * `HUMAN_PREVIEW_CONFIRM`（完整预览＋明确发布），册里的每一张图片走
 * `IMAGE_MEDIA_CHECK_ASYNC`（服务端 mediaCheckAsync，先发后审）。
 *
 * 图片这一条不因为「这些照片上传时已经查过一次」而省掉：ADR-0016 的表按**内容类别**分，
 * 不按「这些字节是不是第一次出现」分，而定稿是这些图片第一次以这个组合、对这些家庭可见。
 * 只声明一条而册里有图，图片那一类就没有声明，等同未声明。
 */
const GATE_PATHS = [
  moderation.GATES.HUMAN_PREVIEW_CONFIRM,
  moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC,
];

// 正文字级，按格边长的比例给。理由与 packages/evaluation 的报告页逐字相同：
// 「一个框放得下几个字」必须按真正渲染出来的字级算，所以同一个数既送进 textCapacity
// 也写进内联样式。
const BODY_FONT_RATIO = 0.35;

Page({
  data: {
    ready: false,
    loading: true,

    growthBookId: 0,
    childId: 0,

    // 版式包缺席时这一段是那句说明，其余一切照旧不显示。
    packReleased: true,
    packReason: '',

    manifest: null,
    totalPages: 0,
    ordinal: 1,
    page: null,
    fontPx: 0,
    lineHeightPx: 0,
    problemTexts: [],
    imageCount: 0,

    contentFingerprint: '',

    // 完整预览的落点：翻到最后一页才算。打开预览不算。
    previewedInFull: false,
    published: false,

    submitting: false,
    attemptKey: '',

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    layout.assertGeometry();
    const q = query || {};
    this.setData({
      ready: true,
      growthBookId: Number(q.growth_book_id) || 0,
      childId: Number(q.child_id) || 0,
    });
    return this.load();
  },

  async load() {
    if (!this.data.growthBookId) {
      this.setData({ loading: false, errorText: '没有指定成长册，无法预览。' });
      return;
    }
    try {
      const [manifest, precheck] = await Promise.all([
        growthBook.manifest(this.data.growthBookId),
        growthBook.precheck(),
      ]);
      const mine = precheck.children.find((r) => r.child_id === this.data.childId) || null;

      if (!manifest.released) {
        // 没有版式包 —— 一种状态，不是一次故障。不取页、不画、不弹窗。
        this.setData({
          loading: false,
          packReleased: false,
          packReason: manifest.reason,
          contentFingerprint: precheck.content_fingerprint,
          published: Boolean(mine && mine.published),
        });
        return;
      }

      this.setData({
        loading: false,
        packReleased: true,
        packReason: '',
        manifest,
        totalPages: manifest.total_pages,
        contentFingerprint: precheck.content_fingerprint,
        published: Boolean(mine && mine.published),
        // 一页的册子，第一页就是最后一页 —— 那时翻到第一页就已经是完整预览。
        previewedInFull: false,
      });
      await this.openPage(1);
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /**
   * 取一页并铺开。
   *
   * 逐页取而不是一次取完：硬上限是 200 页，一次 200 个请求会把教师卡在加载里，而他多半
   * 只想翻几页看看。`fingerprint` 每次都带，漂移回 409 —— 那是「你在看的册子已经变了」
   * 的唯一信号，不能省。
   */
  async openPage(ordinal) {
    if (!this.data.packReleased) return;
    const total = this.data.totalPages;
    if (ordinal < 1 || (total && ordinal > total)) return;

    const size = await measureSize('#sheet');
    const pageWidthPx = (size && size.width) || 0;
    if (!pageWidthPx) return;

    const grid = layout.gridForPageWidth(pageWidthPx);
    const fontPx = Math.max(9, Math.round(grid.cell * BODY_FONT_RATIO));

    try {
      const page = await growthBook.bookPage(this.data.growthBookId, ordinal, {
        fingerprint: this.data.manifest.fingerprint,
        dpr: pixelRatio(),
        pageWidthPx,
        fontPx,
      });
      this.setData({
        ordinal,
        page: {
          ...page,
          offsetLeft: page.grid.box.marginX + page.grid.remainderX / 2,
          offsetTop: page.grid.box.marginY + page.grid.remainderY / 2,
          width: page.grid.usedWidth,
          height: page.grid.usedHeight,
        },
        fontPx,
        lineHeightPx: Math.round(fontPx * layout.LINE_HEIGHT),
        problemTexts: page.problem_texts,
        imageCount: page.widgets.filter((w) => w.kind === 'image' || w.widget_type === 'image').length,
        // 翻到最后一页，完整预览成立。中途退出再进来要重新翻到底 —— `previewedInFull`
        // 不进缓存、不跨页传递，它只描述这一次会话里发生过的事。
        previewedInFull: this.data.previewedInFull || ordinal >= total,
        errorText: '',
        errorRequestId: '',
        errorCanRetry: false,
      });
    } catch (err) {
      reportFailure(this, err, {});
    }
  },

  onPrevPage() {
    return this.openPage(this.data.ordinal - 1);
  },

  onNextPage() {
    return this.openPage(this.data.ordinal + 1);
  },

  /**
   * 确认生成 —— 第二个独立动作，逐册定稿（b1→b2，**永久唯读**）。
   *
   * 幂等键在这里生成一次并留在页面上，重复点击复用同一个：服务端按 §4.2 原样回第一次的
   * 状态码与响应体，**且不重复通知家长**（§4 规则 89 的 n5）。加上 `UNIQUE(child_id,
   * term_id)`，「只存在一份成长册」两半都有着落。
   *
   * `content_fingerprint` 来自预检。不符回 409 `fingerprint_drift` 且零写入 —— 那是
   * 「你预检时看到的班，和你现在要定稿的班，不是同一个班」的防线。
   */
  async onConfirmTap() {
    if (this.data.submitting || this.data.published) return;
    if (!this.data.packReleased) return;

    const attemptKey = this.data.attemptKey || growthBook.newAttemptKey();
    this.setData({
      submitting: true,
      attemptKey,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    try {
      await growthBook.publishBook({
        gates: GATE_PATHS,
        growthBookId: this.data.growthBookId,
        contentFingerprint: this.data.contentFingerprint,
        imageCount: this.data.imageCount,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKey,
      });
      this.setData({ submitting: false, published: true });
    } catch (err) {
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
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

/**
 * 屏幕倍率，照实送。
 *
 * 服务端按 ADR-0015 决策一**把它钳到 ≤ 2** 再算派生尺寸，所以这里不预先钳、也不假设送
 * 多少就得到多少 —— `applied_dpr` 才是服务端实际用的值。
 */
function pixelRatio() {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return (info && info.pixelRatio) || 1;
}
