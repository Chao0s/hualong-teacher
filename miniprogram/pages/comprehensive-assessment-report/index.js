/**
 * 综合评估结果 —— 接 `GET /children/{child_id}/child-assessment/report`
 * （services/assessment.js）。
 *
 * 领域均分与全卷均分**原样取契约的 `average` 与 `total_average`**，页面不重算 ——
 * 报告的口径是「题项级均值」，不是「下级均值的再平均」，两者数值不同而四舍五入到
 * 一位小数看不出来。客户端重算一次就有两个口径，而契约那个才是权威。
 *
 * 雷达图用 canvas 画，几何和原型的 SVG 一致，见 utils/radar.js。
 * `averages` 里的 `null` 就是「未评」——**不是 0 分**，那一个角不画点。
 *
 * 「中二班」去掉了：班名没有数据源，学期名取会话的 `current_term.term_name`。
 */

const assess = require('../../services/assessment.js');
const radar = require('../../utils/radar.js');

Page({
  data: {
    childId: null,
    childName: '',
    childMeta: '',
    statusLabel: '',
    showDetail: false,
    scaleNums: [1, 2, 3, 4, 5],
    legend: [],
    detail: [],
  },

  async onLoad(options) {
    const childId = Number(options.childId) || null;
    // 契约的 ChildAssessmentReport 不带 child_name，姓名由上一层（进度表）带过来。
    const childName = options.childName ? decodeURIComponent(options.childName) : '';
    this.averages = [];
    try {
      const report = await assess.childAssessmentReport(childId);
      this.averages = report.averages;
      const need = assess.scaleItemCount();
      this.setData({
        childId,
        childName,
        statusLabel: report.ratedCount >= need ? '已完成' : '草稿',
        childMeta: `${report.termName}综合评估 · 已评 ${report.ratedCount}/${need} 题`
          + ` · 总均分 ${report.totalAverageLabel}`,
        legend: report.legend.map((d) => ({ label: d.label, value: d.averageLabel })),
        detail: report.detail,
      });
    } catch (err) {
      this.setData({ childId, childName });
      wx.showToast({ title: (err && err.userMessage) || '报告加载失败，请返回重试', icon: 'none' });
    }
    this.drawRadar();
  },

  drawRadar() {
    if (this.data.showDetail) return;
    // 加载失败时 legend 是空的，五个角一个都没有 —— 那时候不画，不画一张空网格。
    if (!this.data.legend.length) return;
    radar.render(this, '#radar', this.data.legend.map((d) => d.label), this.averages);
  },

  onShowResult() {
    if (!this.data.showDetail) return;
    // canvas 是 wx:if 出来的，切回来要等节点重新挂上再画
    this.setData({ showDetail: false }, () => this.drawRadar());
  },

  onShowDetail() {
    this.setData({ showDetail: true });
  },

  onContinue() {
    wx.navigateTo({
      url: `/pages/comprehensive-assessment-form/index?childId=${this.data.childId}`
        + `&childName=${encodeURIComponent(this.data.childName)}`,
    });
  },

  onBack() {
    wx.navigateBack();
  },
});
