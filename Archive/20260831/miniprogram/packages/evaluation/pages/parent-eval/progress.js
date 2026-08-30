/**
 * 家长评价进度 — APP-STRUCTURE.md screen id `ParentEvalProgress`（2026-08-26 收录）。
 *
 * 原型 parent-evaluation-detail.html：一期的完成统计加逐儿一列的提交状态。
 *
 * **教师读到的是「交了没有」，不是家长写了什么。** 家长的评价内容属于家长端，
 * 那一端自己呈现。这一页只读，没有代填、催办或补录入口。
 *
 * 原型这一页的导航标题写作「测评进度」，入口按钮写作「家长评价」；术语表的规范词是
 * 家长评价，所以两处统一用它，原型内部的这处漂移记在结构契约的 note 里，不照抄。
 */

const guard = require('../../../../utils/guard');
const evaluation = require('../../../../services/evaluation');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    roundId: 0,
    columns: evaluation.PARENT_EVAL_COLUMNS,
    round: null,
    rows: [],
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const roundId = Number(query && query.round_id);
    if (!roundId) {
      this.setData({
        ready: true, loading: false, errorText: '没有指定期次，无法打开进度。', errorCanRetry: false,
      });
      return;
    }
    this.setData({ ready: true, roundId });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const view = await evaluation.parentEvalProgress(this.data.roundId);
      this.setData({ round: view, rows: view.rows, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.load();
  },
});
