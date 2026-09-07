/**
 * 教师月度评价 —— 幼儿 × 月份的完成情况矩阵。
 *
 * 数据来自 `GET /home-school/month-evals`，经 `services/co-education.js` 的
 * `monthEvalBoard()`。矩阵的行、列、格全部由 service 算好，页面直接 setData。
 *
 * ── 月份列从数据里来 ───────────────────────────────────────────────────────
 *
 * **不写死月份清单**，也不假设 2—7 月／9—1 月（E1／E4）：列＝库里已存在评价记录的
 * 月份，倒序。中间没有记录的月份**不补空列** —— 补一列等于宣称那个月该有评价，
 * 而那是园所的排程，客户端不知道。
 *
 * ── 格子对外只有两态 ───────────────────────────────────────────────────────
 *
 * `e3 → 已完成`，`e1｜e2｜无记录 → 未完成`。草稿态不对外显示：`e1` 与 `e2` 的分界
 * 没有任何决策定义（G51），所以一格都不能靠它分。
 *
 * ── 填写页本轮没有接 ───────────────────────────────────────────────────────
 *
 * 点格子仍然跳 `teacher-monthly-form`，那一页还是写死的字面量：它的「保存草稿」走
 * `PUT /home-school/month-evals`，而那条端点被 G51 阻断、服务端照实回 501。
 * 跳转参数改成带真实的 `child_id` 与 `month_eval_id`，接那一页时直接可用。
 */

const co = require('../../services/co-education');

Page({
  data: {
    months: [],
    monthLabels: [],
    rows: [],
    gridStyle: '',
    loading: true,
    failed: '',
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, failed: '' });
    try {
      const board = await co.monthEvalBoard({});
      this.setData({
        loading: false,
        months: board.months,
        monthLabels: board.monthLabels,
        rows: board.rows,
        // 列数由数据决定（数据集是 7 个月，原型只画了 4 个），所以网格列数现算。
        gridStyle: `grid-template-columns: 140rpx repeat(${board.months.length}, 1fr);`,
      });
    } catch (err) {
      this.setData({
        loading: false,
        rows: [],
        months: [],
        failed: err.userMessage || '月度评价加载失败，请稍后重试',
      });
    }
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/teacher-monthly-form/index' });
  },

  /** 已完成的带 view=1 进只读查看，未完成的直接进填写，和原型的链接一致。 */
  onDotTap(e) {
    const { child, month, evalId, done } = e.currentTarget.dataset;
    const view = done ? '&view=1' : '';
    const id = evalId ? `&id=${evalId}` : '';
    wx.navigateTo({
      url: `/pages/teacher-monthly-form/index?child=${child}&month=${month}${id}${view}`,
    });
  },
});
