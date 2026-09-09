/**
 * 综合评估共享数据与草稿存储 —— 原样搬自原型 screens/assessment-store.js。
 *
 * 四个页面共用：综合评估入口、开始评估、评估结果、班级评估报告。
 * 只改了两处，其余（124 题量表、铺分算法、演示数据）一字未动：
 *   1. localStorage 换成 wx.getStorageSync / wx.setStorageSync。
 *      小程序的 Storage 直接存对象，不用自己 JSON.parse／stringify；取不到时返回空串。
 *   2. 末尾补 module.exports，原型里这些是挂在全局的。
 *   3. 2026-09-09：ASSESS_SCALE 由内嵌 124 行改为从 ../data/guide-scale 派生（#20）。
 */

/* 综合评估共享数据与草稿存储（原型阶段用 localStorage 模拟后端草稿接口） */
const ASSESS_CHILDREN = [
  { id: 'chen', name: '陈小明' },
  { id: 'li', name: '李雨萱' },
  { id: 'zhang', name: '张力轩' },
  { id: 'wang', name: '王子涵' },
  { id: 'zhao', name: '赵佳怡' }
];

/* 量表结构：从权威派生，不再抄一份。
   此前这里内嵌 124 个题号与名称 —— 而 npm test 的那道闸门只比 questions.js 与权威，
   **完全没盖到这一份**（#20）。现在三份收成一份。
   只用到三样：domain.name、domain.items.length、item.id。 */
const { flatDomains } = require('../data/guide-scale');

const ASSESS_SCALE = flatDomains();

const AssessStore = (() => {
  const KEY = 'hualong.comp-assessment.v1';
  const TOTAL = ASSESS_SCALE.reduce((n, d) => n + d.items.length, 0);
  let memory = null;

  function read() {
    try {
      const raw = wx.getStorageSync(KEY);
      return raw === '' || raw === undefined ? null : raw;
    } catch (e) { return memory; }
  }
  function write(all) {
    memory = all;
    try { wx.setStorageSync(KEY, all); } catch (e) {}
  }
  function statusOf(record) {
    if (!record || !record.rated) return 'miss';
    return record.rated >= TOTAL ? 'done' : 'draft';
  }
  /* 按领域目标均分铺分：n 题中取 k 题给 base+1、其余给 base，使该领域均值≈目标值。
     k 题在领域内均匀散开，避免明细里出现一整段相同分值。 */
  function profileScores(targets) {
    const scores = {};
    ASSESS_SCALE.forEach(domain => {
      const target = targets[domain.name];
      const n = domain.items.length;
      const base = Math.floor(target);
      const k = Math.round((target - base) * n);
      domain.items.forEach((item, i) => {
        const bump = Math.floor((i + 1) * k / n) > Math.floor(i * k / n) ? 1 : 0;
        scores[item.id] = Math.min(5, Math.max(1, base + bump));
      });
    });
    return scores;
  }
  function record(scores) {
    const rated = Object.keys(scores).length;
    return { scores: scores, rated: rated, total: TOTAL, status: rated === TOTAL ? 'done' : 'draft' };
  }
  /* 首次进入铺演示数据；之后一律以教师实际填写的草稿为准，不再覆盖 */
  function seedIfEmpty() {
    if (read() !== null) return;
    const full = targets => record(profileScores(targets));
    const partial = (targets, count) => {
      const all = profileScores(targets);
      const ids = ASSESS_SCALE.flatMap(d => d.items.map(i => i.id)).slice(0, count);
      const scores = {};
      ids.forEach(id => { scores[id] = all[id]; });
      return record(scores);
    };
    write({
      chen: full({ 健康: 4.6, 语言: 4.1, 社会: 4.4, 科学: 3.2, 艺术: 3.8 }),
      wang: full({ 健康: 4.2, 语言: 4.7, 社会: 3.7, 科学: 4.5, 艺术: 4.6 }),
      li: partial({ 健康: 4.0, 语言: 3.6, 社会: 4.2, 科学: 3.4, 艺术: 3.9 }, 86),
      zhao: partial({ 健康: 3.5, 语言: 4.3, 社会: 3.8, 科学: 3.6, 艺术: 4.1 }, 68)
    });
  }
  /* 领域均分：只统计已评题项，未评领域返回 null */
  function domainAverages(scores) {
    return ASSESS_SCALE.map(domain => {
      const nums = domain.items.map(item => scores[item.id]).filter(Boolean);
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    });
  }
  function childName(id) {
    const child = ASSESS_CHILDREN.find(c => c.id === id);
    return child ? child.name : '';
  }

  return { KEY, TOTAL, read, write, statusOf, seedIfEmpty, domainAverages, childName };
})();

module.exports = { ASSESS_CHILDREN, ASSESS_SCALE, AssessStore };
