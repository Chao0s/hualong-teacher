/**
 * 班级评估报告 —— 原型 screens/comprehensive-assessment-class-report.html 的小程序版本。
 *
 * 汇总口径照抄原型：
 *   只算「已完成」的那几份，草稿不计入（和抬头文案「已提交」的说法对齐）；
 *   领域均分是题项级汇总 —— 把所有已提交幼儿在该领域的每一道题的分放在一起求均值，
 *   不是先算每人领域均分再平均；
 *   班级均分是所有已提交幼儿全部题项得分的均值。
 */

const { ASSESS_CHILDREN, ASSESS_SCALE, AssessStore } = require('../../utils/assessment-store.js');
const radar = require('../../utils/radar.js');

Page({
  data: {
    heroNote: '',
    doneRatio: '0/0',
    classAvg: '—',
    legend: [],
  },

  onLoad() {
    AssessStore.seedIfEmpty();

    const all = AssessStore.read() || {};
    const submitted = ASSESS_CHILDREN
      .map((child) => all[child.id])
      .filter((record) => AssessStore.statusOf(record) === 'done');

    this.averages = ASSESS_SCALE.map((domain) => {
      const nums = submitted.reduce((acc, record) => acc.concat(
        domain.items.map((item) => record.scores[item.id]).filter(Boolean),
      ), []);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    });

    const allScores = submitted.reduce((acc, r) => acc.concat(Object.values(r.scores)), []);
    const classAvg = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

    this.setData({
      doneRatio: `${submitted.length}/${ASSESS_CHILDREN.length}`,
      classAvg: classAvg ? classAvg.toFixed(1) : '—',
      heroNote: submitted.length
        ? `基于已提交的 ${submitted.length} 份五大领域李克特量表（每份 ${AssessStore.TOTAL} 题）汇总。`
        : '暂无已完成的评估，完成后即可查看班级汇总。',
      legend: ASSESS_SCALE.map((domain, i) => ({
        label: domain.name,
        value: this.averages[i] ? this.averages[i].toFixed(1) : '未评',
      })),
    });
  },

  onReady() {
    radar.render(this, '#radar', ASSESS_SCALE.map((d) => d.name), this.averages);
  },

  onContinue() {
    wx.navigateTo({ url: '/pages/comprehensive-assessment-form/index' });
  },

  onBack() {
    wx.navigateBack();
  },
});
