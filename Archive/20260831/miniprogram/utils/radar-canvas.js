/**
 * 五维雷达图的画布绘制。**一份实现，两个页面。**
 *
 * 票据 18 把它写在 `packages/assessment/pages/radar/index.js` 里，那时只有一个调用方。
 * 票据 20 的综合评估报告要画同一张图，而两个页面在**两个分包**里，各抄一遍就会有两张
 * 画法可能不同的图 —— 版式规格 §9.1.2 对成长册要求「像素级一致度 ≥ 95%」正是在防这件事。
 * 所以它搬到了 `utils/`：分包规则只管 `services/`，两个分包都 require 得到这一份。
 *
 * 搬过来的只有这一个函数。量画布、设后备缓冲、清屏那几步留在各自的页面里 —— 那是页面
 * 的生命周期（什么时候画、画不画），不是绘图本身。
 *
 * **这里不算分。** 五个轴的数值全部来自 `services/assessment` 的 `radarModel`，取整在那里
 * 做过一次（一位小数，四舍五入）。图上写的 `value_label` 与表里绑的是同一个字符串。
 * 本文件唯一的算术是几何：把 1—5 分换成半径。那是像素，不是分数。
 *
 * 契约那一侧同一条结论：`getChildAssessmentReport` 写着「雷达图零存储」—— 不存图档、
 * 不存 base64、不开列，两端即时画（版式规格 §9.4）。
 */

// 画布上的留白，CSS 像素。轴末的领域名与数值要放得下，不然会被画布边缘切掉。
const LABEL_ROOM = 34;
const LABEL_GAP = 14;

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
  // 写的是 `value_label`，与表里逐字相同 —— 服务层给的同一个字符串。
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

module.exports = {
  drawRadar,
};
