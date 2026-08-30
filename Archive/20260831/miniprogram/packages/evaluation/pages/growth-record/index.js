/**
 * 儿童成长档案 — APP-STRUCTURE.md screen id `GrowthRecord`（2026-08-26 收录）。
 *
 * 原型 growth-record.html：三个入口加一张逐儿六列的进度表。
 *
 * **入口是三个，不是五个。** spec 05 的 `entry_reduction` 写着：儿童评价入口由 5 个
 * 并为 3 个 —— 发布家长评价、教师评价、成长册。月度与学期评价不在这一层，它们在
 * 「教师评价」里面。
 *
 * 只读页：本页不产生任何内容，六列都是别处写入的结果。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const { reportFailure } = require('../../../../utils/present');

const ENTRIES = [
  { key: 'parentEval', label: '发布家长评价', primary: true },
  { key: 'teacherEval', label: '教师评价', primary: false },
  { key: 'book', label: '成长册', primary: false },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    entries: ENTRIES,
    columns: evaluation.GROWTH_RECORD_COLUMNS,
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
      const rows = await evaluation.growthRecordRoster();
      this.setData({ rows, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },

  onEntryTap(e) {
    switch (e.currentTarget.dataset.key) {
      case 'parentEval': return evaluation.openParentEval();
      case 'teacherEval': return evaluation.openTeacherEval();
      // 成长册是票据 21 建的页面，这一条只是多一道门，不是第二个实现。
      case 'book': return evaluation.openBook();
      default: return undefined;
    }
  },
});
