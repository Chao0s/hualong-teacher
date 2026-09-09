/**
 * 班级评估报告 —— 接 `GET /child-assessments/class-report`（services/assessment.js）。
 *
 * **只统计「已完成」（c1）的评估，草稿不计入** —— 这个过滤在 `x-hualong-scope` 里，
 * 是**服务端的事，客户端不补**：补一遍等于把范围判定搬到客户端，那时候「服务端漏了
 * 过滤」就再也没人会发现。
 *
 * 领域均分是题项级汇总（把所有已完成幼儿在该领域的每一道题的分放在一起求均值），
 * 不是先算每人领域均分再平均 —— 题项数不等会造成加权失真。这一层由服务端算，
 * 页面原样用。
 *
 * `assessed_child_count` 是**样本量**，不是班级人数；「已完成 N/M」里那个 M 契约没给，
 * service 取名册长度。
 */

const assess = require('../../services/assessment.js');
const radar = require('../../utils/radar.js');

Page({
  data: {
    heroNote: '',
    doneRatio: '0/0',
    classAvg: '—',
    domainCount: 0,
    legend: [],
  },

  async onLoad() {
    this.averages = [];
    try {
      const report = await assess.classReport();
      this.averages = report.averages;
      this.setData({
        doneRatio: report.doneRatio,
        // 班级均分契约没有单独一格，所以按 `item_count` 加权还原（见 `weighted`）。
        // 空态给「—」，不给 0.0：空态与有资料两种字不一样，交给 heroNote 说。
        classAvg: report.empty ? '—' : this.weighted(report.legend),
        domainCount: report.domainCount,
        heroNote: report.heroNote,
        legend: report.legend.map((d) => ({ label: d.label, value: d.averageLabel })),
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '班级报告加载失败，请返回重试', icon: 'none' });
    }
    // 加载失败时 legend 是空的，那时候不画，不画一张空网格。
    if (!this.data.legend.length) return;
    radar.render(this, '#radar', this.data.legend.map((d) => d.label), this.averages);
  },

  /**
   * 班级均分。`ChildAssessmentClassReport` 只给逐领域的 `average` 与 `item_count`，
   * **没有全卷那一格**，所以这里按 `item_count` 加权还原题项级均值 ——
   * 用领域均分直接再平均会加权失真（H 36 题与 A 11 题不等权）。
   */
  weighted(legend) {
    let sum = 0;
    let n = 0;
    legend.forEach((d) => {
      if (d.average === null) return;
      sum += d.average * d.itemCount;
      n += d.itemCount;
    });
    return n ? (sum / n).toFixed(1) : '—';
  },

  onContinue() {
    wx.navigateTo({ url: '/pages/growth-comprehensive-assessment/index' });
  },

  onBack() {
    wx.navigateBack();
  },
});
