/**
 * 生成五维雷达图 — APP-STRUCTURE.md screen id `Radar`（票据 18）。
 *
 * 一个页面，两种口径：带 `child_id` 是个人报告，带 `scope=class` 是班级报告。两者的
 * 数据形状相同（五个领域的题项级均值），所以图与表只有一份代码。
 *
 * ── 为什么是画布 ─────────────────────────────────────────────────────────────
 *
 * **原型靠脚本算顶点再写进内联矢量元素，这条路在小程序里两头都断**：WXML 没有
 * `<svg>`，而运行时也够不到文档对象去插节点。所以改由画布绘制，用的是新版
 * Canvas 2D（`type="2d"` ＋ `SelectorQuery`），不是已废弃的旧接口。
 *
 * 契约那一侧是同一条结论：`getChildAssessmentReport` 写着「**雷达图零存储**：不存图档、
 * 不存 base64、不开列；客户端 canvas 直接画」。
 *
 * ── 这一页不算分 ─────────────────────────────────────────────────────────────
 *
 * 五个轴的数值全部来自 `services/assessment` 的 `radarModel`，取整也在那里做过一次
 * （一位小数，四舍五入，理由写在那个文件的 `roundScore` 上方）。**图画的数与表写的数是
 * 同一个数**，这一页一次算术也不做 —— 图上画 3.67 而表里写 3.7，教师会去想那 0.03 是
 * 什么。
 *
 * 唯一的算术是几何：把 1—5 分换成半径。那是像素，不是分数。
 *
 * ── 清屏与倍率 ───────────────────────────────────────────────────────────────
 *
 * 每次重绘都先 `clearRect` 再画。重设 `canvas.width` 本身也会清空并复位变换，但那是
 * 副作用不是意图 —— 显式清一次，让「不残留上一次的图形」是写出来的，不是碰巧的。
 * 复位之后 `ctx.scale(dpr, dpr)` 必须重新调用，否则第二次重绘会缩回一倍。
 */

const guard = require('../../../../utils/guard');
const assessment = require('../../../../services/assessment');
const { reportFailure } = require('../../../../utils/present');

// 画布上的留白，CSS 像素。轴末的领域名与数值要放得下，不然会被画布边缘切掉。
const LABEL_ROOM = 34;
const LABEL_GAP = 14;

Page({
  data: {
    ready: false,
    loading: true,

    scope: 'child',
    childId: 0,
    title: '',
    subtitle: '',
    // 五个轴，图与表读的是同一份。
    radar: null,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const childId = Number((query || {}).child_id) || 0;
    this.setData({
      ready: true,
      scope: childId ? 'child' : 'class',
      childId,
    });
    return this.load();
  },

  async load() {
    try {
      const report = this.data.childId
        ? await assessment.childReport(this.data.childId)
        : await assessment.classReport();
      this.setData({
        loading: false,
        title: this.data.childId ? '五维雷达图' : '班级五维雷达图',
        subtitle: this.data.childId
          ? [report.radar.scale_label, report.radar.date_label].filter(Boolean).join(' · ')
          : report.sample_label,
        radar: report.radar,
      });
      await this.draw();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /**
   * 下拉刷新。**这是得分变化时的重绘路径**：班级报告随同事陆续提交而变，页面要能再读
   * 一次并重画，而重画不得留下上一次的图形。
   */
  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  /**
   * 量到画布节点。新版接口只有这一条路：`SelectorQuery` 取 `node` 与 `size`。
   *
   * 选择器落空时回 null 而不是抛错 —— 空状态下画布根本没有渲染，那时量不到是正常的。
   */
  measureCanvas() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .select('#radar')
        .fields({ node: true, size: true })
        .exec((res) => {
          const hit = res && res[0];
          resolve(hit && hit.node ? hit : null);
        });
    });
  },

  /**
   * 屏幕倍率。2 倍屏与 3 倍屏各自把后备缓冲放大到那么多倍，再由 CSS 尺寸缩回去 ——
   * 少了这一步，图在高倍率屏上是糊的。
   *
   * `getWindowInfo` 是 `getSystemInfo` 拆分后承接 `pixelRatio` 的那一个；老基础库上
   * 回退到 `getSystemInfoSync`，与 app.js 的 `measureSafeArea` 用同一种写法。
   */
  pixelRatio() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return (info && info.pixelRatio) || 1;
  },

  /**
   * 画一次。
   *
   * **没有得分就不走绘制路径**：五个轴齐了才画得出五边形，缺轴的多边形合不拢，硬画出来
   * 的那条边是编的。空状态由 WXML 那一行说明性文字承担（验收项 8）。
   */
  async draw() {
    const radar = this.data.radar;
    if (!radar || !radar.can_draw) return;

    const hit = await this.measureCanvas();
    if (!hit) return;

    const canvas = hit.node;
    const width = hit.width;
    const height = hit.height;
    const ctx = canvas.getContext('2d');
    const dpr = this.pixelRatio();

    // 后备缓冲 = CSS 尺寸 × 像素比。设 width／height 会同时清空画布并复位变换矩阵，
    // 所以 scale 必须排在它们之后，每次重绘都要重来一遍。
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 显式清屏，先于任何一笔绘制。见本文件头注。
    ctx.clearRect(0, 0, width, height);

    drawRadar(ctx, width, height, radar);
  },
});

/**
 * 五维雷达图的几何。
 *
 * 半径的映射是 `r = R × 分 / 5`：0 分在圆心，5 分在最外圈。**不用 (v-1)/4** —— 那会把
 * 1 分画成圆心的一个点，而 1 分是「达到 3~4 岁典型水平」，不是「什么都没有」。
 *
 * 五个轴从正上方开始，顺时针，与 `DOMAINS` 的顺序一一对应（健康／语言／社会／科学／艺术）。
 * 半径用 `min(宽, 高)`，所以窄屏与宽屏上五边形都是正的，不会被拉扁。
 */
function drawRadar(ctx, width, height, radar) {
  const axes = radar.axes;
  const count = axes.length;
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.max(10, Math.min(width, height) / 2 - LABEL_ROOM);
  const step = (Math.PI * 2) / count;
  const angleAt = (i) => -Math.PI / 2 + i * step;
  const pointAt = (i, value) => {
    const r = (R * value) / radar.max;
    return { x: cx + r * Math.cos(angleAt(i)), y: cy + r * Math.sin(angleAt(i)) };
  };

  // 底纹：五圈刻度，每圈是一分。刻度线让教师读得出「这个角伸到第几圈」。
  ctx.strokeStyle = '#dfe6e6';
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= radar.max; ring += 1) {
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const p = pointAt(i, ring);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // 五条轴线。
  for (let i = 0; i < count; i += 1) {
    const p = pointAt(i, radar.max);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  // 得分多边形。填充半透明，描边实色 —— 底纹的刻度线要透得出来。
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const p = pointAt(i, axes[i].value);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(24, 155, 145, 0.18)';
  ctx.fill();
  ctx.strokeStyle = '#189b91';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 顶点。
  ctx.fillStyle = '#189b91';
  for (let i = 0; i < count; i += 1) {
    const p = pointAt(i, axes[i].value);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 轴末的领域名与**数值**。教师要的是数值不是形状，所以数值就写在图上，不只写在表里。
  // 写的是 `value_label`，与下面那张表逐字相同 —— 服务层给的同一个字符串。
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3d4a4a';
  for (let i = 0; i < count; i += 1) {
    const angle = angleAt(i);
    const x = cx + (R + LABEL_GAP) * Math.cos(angle);
    const y = cy + (R + LABEL_GAP) * Math.sin(angle);
    // 左半边的字右对齐、右半边左对齐，正上下居中：三档就够，五个轴不会互相压。
    const cos = Math.cos(angle);
    ctx.textAlign = Math.abs(cos) < 0.1 ? 'center' : (cos > 0 ? 'left' : 'right');
    ctx.fillText(`${axes[i].name} ${axes[i].value_label}`, x, y);
  }
}
