/**
 * 教师评价 — APP-STRUCTURE.md screen id `TeacherEvalHome`（2026-08-26 收录）。
 *
 * 原型 teacher-evaluation.html：四个评价入口加一张逐儿四列的进度表。
 *
 * **这一页一个写入控件也没有。** spec 05 的 `write_control_count = 0` 说的就是它：
 * 本页只导航与只读展示，四种评价各自在自己的页面里写。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const { reportFailure } = require('../../../../utils/present');

const ENTRIES = [
  { key: 'month', label: '月度评价', primary: true },
  { key: 'term', label: '学期评价', primary: false },
  { key: 'comprehensive', label: '综合评估', primary: false },
  { key: 'message', label: '教师寄语', primary: false },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    entries: ENTRIES,
    columns: evaluation.TEACHER_EVAL_COLUMNS,
    rows: [],
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const rows = await evaluation.teacherEvalRoster();
      this.setData({ rows, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  /**
   * 四个入口都**不带幼儿**：这一页是班级层的聚合，选谁是下一页的事。月度与学期
   * 评价页本来就支持不带 `child_id` 进入（它们自己有选择幼儿的滚轮）。
   *
   * 综合评估报告是例外：它是一名幼儿的一份报告，没有班级层的形态，所以这一条进的是
   * 五维图那张班级聚合页——从那里点一名幼儿才到得了报告。
   */
  onEntryTap(e) {
    switch (e.currentTarget.dataset.key) {
      case 'month': return evaluation.openMonth();
      case 'term': return evaluation.openTerm();
      case 'comprehensive': return evaluation.openFiveChart();
      case 'message': return evaluation.openMessage();
      default: return undefined;
    }
  },
});
