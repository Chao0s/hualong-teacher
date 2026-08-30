/**
 * 开始综合评估 —— 原型 screens/comprehensive-assessment-form.html 的小程序版本。
 *
 * 题库在 ./questions.js（124 题，含提问和 1／3／5 锚点），草稿存储用共用的 AssessStore。
 *
 * 口径照抄原型：
 *   每改一个分立刻写草稿；一个分都没打时把这个幼儿从草稿里删掉，而不是留一条空记录。
 *   领域标题右侧显示「已评/总数 · 平均 x.x」，一题没评显示「未评 0/n」。
 *   底部平均分只统计已评题项。
 *   保存按钮按已评题数给三种提示：没评过 / 草稿 / 已完成。
 *
 * 一处优化：折叠的领域不渲染题目。124 题全展开是几千个节点，小程序会卡；
 * 折叠态本来就看不见，行为一致。
 */

const QUESTIONS = require('./questions.js');
const { ASSESS_CHILDREN, AssessStore } = require('../../utils/assessment-store.js');

const TOTAL = AssessStore.TOTAL;

/** 把题库摊成 wxml 能直接循环的形状，顺便把参考表的数对拼成字符串。 */
function buildDomains(scores) {
  return QUESTIONS.map((domain) => ({
    id: domain.id,
    name: domain.name,
    open: false,
    scoreText: '',
    items: domain.items.map((item) => ({
      id: item.id,
      name: item.name,
      q: item.q,
      a1: item.a['1'],
      a3: item.a['3'],
      a5: item.a['5'],
      measured: !!item.m,
      note: item.note || '',
      ref: item.ref
        ? item.ref.map((row) => ({
          age: row.age,
          bh: `${row.b[0][0]}~${row.b[0][1]}`,
          bw: `${row.b[1][0]}~${row.b[1][1]}`,
          gh: `${row.g[0][0]}~${row.g[0][1]}`,
          gw: `${row.g[1][0]}~${row.g[1][1]}`,
        }))
        : null,
      score: scores[item.id] || 0,
    })),
  }));
}

Page({
  data: {
    children: ASSESS_CHILDREN,
    childIndex: 0,
    scaleNums: [1, 2, 3, 4, 5],
    domains: [],
    avg: '—',
    progressHint: `已评 0/${TOTAL} · 草稿自动保存`,
  },

  onLoad(options) {
    AssessStore.seedIfEmpty();
    let index = ASSESS_CHILDREN.findIndex((c) => c.id === options.child);
    if (index < 0) index = 0;
    this.setData({ childIndex: index });
    this.loadChild();
  },

  loadChild() {
    const childId = ASSESS_CHILDREN[this.data.childIndex].id;
    const record = (AssessStore.read() || {})[childId];
    this.scores = record && record.scores ? { ...record.scores } : {};
    this.setData({ domains: buildDomains(this.scores) });
    this.updateScores();
  },

  onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value) });
    this.loadChild();
  },

  onToggleDomain(e) {
    const di = e.currentTarget.dataset.di;
    this.setData({ [`domains[${di}].open`]: !this.data.domains[di].open });
  },

  onScoreTap(e) {
    const { di, ii, score } = e.currentTarget.dataset;
    const item = this.data.domains[di].items[ii];
    this.scores[item.id] = Number(score);
    this.setData({ [`domains[${di}].items[${ii}].score`]: Number(score) });
    this.persist();
    this.updateScores();
  },

  /** 每次改动即写草稿。一个分都没有时删掉这条，不留空记录。 */
  persist() {
    const childId = ASSESS_CHILDREN[this.data.childIndex].id;
    const all = AssessStore.read() || {};
    const rated = Object.keys(this.scores).length;
    if (rated === 0) delete all[childId];
    else all[childId] = { scores: this.scores, rated, total: TOTAL, status: rated === TOTAL ? 'done' : 'draft' };
    AssessStore.write(all);
  },

  updateScores() {
    const patch = {};
    let all = [];

    this.data.domains.forEach((domain, di) => {
      const nums = domain.items.map((item) => this.scores[item.id]).filter(Boolean);
      all = all.concat(nums);
      patch[`domains[${di}].scoreText`] = nums.length
        ? `${nums.length}/${domain.items.length} · 平均 ${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)}`
        : `未评 0/${domain.items.length}`;
    });

    patch.avg = all.length ? (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1) : '—';
    patch.progressHint = all.length === TOTAL
      ? `已评 ${TOTAL}/${TOTAL} · 可保存为已完成`
      : `已评 ${all.length}/${TOTAL} · 草稿自动保存`;

    this.setData(patch);
  },

  onSave() {
    this.persist();
    const rated = Object.keys(this.scores).length;
    wx.showToast({
      title: rated === 0 ? '尚未评分，无内容可保存'
        : rated === TOTAL ? '综合评估已完成并保存'
          : `已保存为草稿（${rated}/${TOTAL}）`,
      icon: 'none',
    });
  },
});
