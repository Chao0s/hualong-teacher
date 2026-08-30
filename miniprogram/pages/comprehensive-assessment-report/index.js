/**
 * 综合评估结果 —— 原型 screens/comprehensive-assessment-report.html 的小程序版本。
 *
 * 数据全部来自共用的 AssessStore。领域均分只统计已评题项，一题没评的领域算「未评」。
 * 雷达图用 canvas 画，几何和原型的 SVG 一致，见 utils/radar.js。
 */

const { ASSESS_CHILDREN, ASSESS_SCALE, AssessStore } = require('../../utils/assessment-store.js');
const radar = require('../../utils/radar.js');

const STATUS_LABEL = { done: '已完成', draft: '草稿', miss: '未完成' };

Page({
  data: {
    childId: 'chen',
    childName: '',
    childMeta: '',
    statusLabel: '',
    showDetail: false,
    scaleNums: [1, 2, 3, 4, 5],
    legend: [],
    detail: [],
  },

  onLoad(options) {
    AssessStore.seedIfEmpty();

    const childId = ASSESS_CHILDREN.some((c) => c.id === options.child) ? options.child : 'chen';
    const record = (AssessStore.read() || {})[childId] || null;
    const scores = record ? record.scores : {};
    const status = AssessStore.statusOf(record);
    this.averages = AssessStore.domainAverages(scores);

    this.setData({
      childId,
      childName: AssessStore.childName(childId),
      statusLabel: STATUS_LABEL[status],
      childMeta: status === 'done' ? `中二班 · 2026 春季综合评估 · ${AssessStore.TOTAL} 题已完成`
        : status === 'draft' ? `中二班 · 2026 春季综合评估 · 已填写 ${record.rated}/${AssessStore.TOTAL} 题`
          : '中二班 · 2026 春季综合评估 · 尚未开始填写',

      legend: ASSESS_SCALE.map((domain, i) => ({
        label: domain.name,
        value: this.averages[i] ? this.averages[i].toFixed(1) : '未评',
      })),

      detail: ASSESS_SCALE.map((domain, i) => ({
        name: domain.name,
        avgText: this.averages[i] ? `平均 ${this.averages[i].toFixed(1)}` : '未评',
        items: domain.items.map((item) => ({ id: item.id, name: item.name, score: scores[item.id] || 0 })),
      })),
    });
  },

  onReady() {
    this.drawRadar();
  },

  drawRadar() {
    if (this.data.showDetail) return;
    radar.render(this, '#radar', ASSESS_SCALE.map((d) => d.name), this.averages);
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
    wx.navigateTo({ url: `/pages/comprehensive-assessment-form/index?child=${this.data.childId}` });
  },

  onBack() {
    wx.navigateBack();
  },
});
