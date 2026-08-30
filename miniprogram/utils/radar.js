/**
 * 五大领域雷达图 —— 对照原型 comprehensive-assessment-report.html 和
 * comprehensive-assessment-class-report.html 里那段 SVG 绘制代码。
 *
 * 小程序没有 <svg> 标签，改用 canvas 2d 画同样的几何：
 *   原型的 viewBox 是 0 0 200 200，中心 (100,100)，最外圈半径 72，
 *   第一个顶点在正上方，五个顶点按顺时针均分。
 *   坐标算法一字未改，只是把 SVG 元素换成 canvas 调用。
 *
 * 颜色也照抄原型的 CSS：
 *   网格线和轴线 #d7e4e4，填充 rgba(24,155,145,.22)，描边 #189b91 宽 2.4，
 *   顶点圆点 #067e76 半径 3.6，标签 #555 字号 12。
 */

const VIEW = 200;
const CENTER = 100;
const MAX_R = 72;
// 标签放在最外圈再往外一点，5.78/5 是原型里的取值
const LABEL_LEVEL = 5.78;

function point(index, count, value) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
  const radius = (MAX_R * value) / 5;
  return [CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius];
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * @param ctx      canvas 2d 上下文
 * @param labels   五个领域名
 * @param averages 五个领域均分，未评的那一项传 null
 * @param size     画布的 CSS 边长，用来把 200 的坐标系缩放上去
 */
function draw(ctx, labels, averages, size) {
  const n = labels.length;
  const k = size / VIEW;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(k, k);

  // 五圈网格
  ctx.strokeStyle = '#d7e4e4';
  ctx.lineWidth = 1;
  for (let level = 1; level <= 5; level += 1) {
    polygon(ctx, labels.map((_, i) => point(i, n, level)));
    ctx.stroke();
  }

  // 五条轴线
  labels.forEach((_, i) => {
    const [x, y] = point(i, n, 5);
    ctx.beginPath();
    ctx.moveTo(CENTER, CENTER);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  // 数据多边形。未评的领域按 0 算，和原型一致
  const points = averages.map((avg, i) => point(i, n, avg || 0));
  polygon(ctx, points);
  ctx.fillStyle = 'rgba(24, 155, 145, 0.22)';
  ctx.fill();
  ctx.strokeStyle = '#189b91';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // 顶点圆点：一个领域都没评时不画，和班级报告的判断一致
  if (averages.some(Boolean)) {
    ctx.fillStyle = '#067e76';
    points.forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 领域名
  ctx.fillStyle = '#555';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  labels.forEach((label, i) => {
    const [x, y] = point(i, n, LABEL_LEVEL);
    ctx.fillText(label, x, y);
  });

  ctx.restore();
}

/**
 * 取到页面上的 canvas 并画一次。
 * 小程序的 canvas 要自己按像素比放大，否则在高分屏上是糊的。
 */
function render(page, selector, labels, averages) {
  wx.createSelectorQuery()
    .in(page)
    .select(selector)
    .fields({ node: true, size: true })
    .exec((res) => {
      if (!res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);
      draw(ctx, labels, averages, res[0].width);
    });
}

module.exports = { draw, render };
