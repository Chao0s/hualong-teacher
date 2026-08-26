/**
 * 评价五维图入口页 — APP-STRUCTURE.md screen id `FiveChart`（票据 18）。
 *
 * 入口页、量表、五维雷达图是**一条不能拆的链**：没有已提交的量表，图上没有东西可画。
 * 所以这一页做的是把每名幼儿放在链上的哪一节说清楚，再把教师送到那一节去：
 *
 *   未开始 / 草稿  -> 量表页，接着填
 *   已完成          -> 雷达图页，看这名幼儿的五维图
 *   班级            -> 雷达图页的班级口径，**只统计已提交**，草稿不计入
 *
 * 进度是**本页三态**（契约 E4）：等于题数已完成、1 到题数减一是草稿、0 未开始。三态由
 * 数字自己表达，本页不另存一个状态。向上聚合的那些页面一律二元（草稿折算未完成），
 * 那是它们的口径，不是这一页的。
 */

const guard = require('../../../../utils/guard');
const assessment = require('../../../../services/assessment');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,

    rows: [],
    summary: '',
    // 班级报告的入口说明。已完成为 0 时说出原因，而不是给一个点开是空的按钮。
    classHint: '',

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    // 返回 promise：平台忽略它，但测试要等它读完，不必靠 sleep 猜时机。
    return this.load();
  },

  async load() {
    try {
      const rows = await assessment.listChildAssessments();
      const done = rows.filter((r) => r.done).length;
      this.setData({
        loading: false,
        rows,
        summary: `本班 ${rows.length} 名幼儿，已提交 ${done} 份量表。`,
        classHint: done === 0
          ? '班级五维雷达图只统计已提交的量表，本班还没有一份，暂时没有图可画。'
          : `班级五维雷达图按这 ${done} 份已提交的量表计算，草稿不计入。`,
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /** 点一名幼儿：已提交的去看图，没提交的去接着填。 */
  onChildTap(e) {
    const childId = Number(e.currentTarget.dataset.childId);
    const row = this.data.rows.find((r) => r.child_id === childId);
    if (!row) return;
    if (row.done) assessment.openRadar(childId);
    else assessment.openScale(childId);
  },

  onClassRadarTap() {
    assessment.openRadar();
  },
});
