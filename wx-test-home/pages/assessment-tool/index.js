/**
 * 质量评估 —— 原型 screens/assessment-tool.html 的小程序版本。
 *
 * 题库 120 条在 ./assessment-data.js，原样搬自原型的外链脚本。
 *
 * 口径全部照抄原型：
 *   得分率 = 已评项分数之和 ÷ (已评项数 × 5)，未评的项不进分母
 *   等级   = 在 scoring.levels 里找最后一条 ratio >= min 的
 *   再点一次同一个分数会取消该项评分
 *   1 分和 5 分要留佐证，指标里会多出一条红色提示
 *   筛选  全部 / 未评 / 低分（1–2 分）
 *
 * 存储键也照抄：hualong_assessment_<code>_<version>，评价记录另存一个键。
 */

const DATA = require('./assessment-data.js');

const TOOL = { code: 'school-quality-120', version: '1.0.0', itemCount: 120 };
const KEY = `hualong_assessment_${TOOL.code}_${TOOL.version}`;
const NKEY = `hualong_assessment_notes_${TOOL.code}_${TOOL.version}`;

const OPTIONS = DATA.scoring.options;
const LEVELS = DATA.scoring.levels;
const LABELS = {};
OPTIONS.forEach((o) => { LABELS[o.score] = o.label; });

function chipText(score) {
  return score ? `${score}分 ${LABELS[score]}` : '未评';
}

function chipCls(score) {
  if (!score) return '';
  if (score <= 2) return 'chip-score--low';
  if (score === 3) return 'chip-score--mid';
  return 'chip-score--high';
}

function levelOf(ratio) {
  let label = LEVELS[0].label;
  LEVELS.forEach((r) => { if (ratio >= r.min) label = r.label; });
  return label;
}

Page({
  data: {
    options: OPTIONS,
    label1: LABELS[1],
    label3: LABELS[3],
    label5: LABELS[5],

    sections: [],
    mode: 'all',
    filters: [
      { key: 'all', label: '全部', count: TOOL.itemCount },
      { key: 'todo', label: '未评', count: TOOL.itemCount },
      { key: 'low', label: '低分', count: 0 },
    ],
    emptyText: '',

    dialPct: 0,
    dialText: '—',
    sumLevel: '未开始',
    sumCount: `已评 0 / ${TOOL.itemCount} 项 · ${TOOL.code} v${TOOL.version}`,
    barPct: 0,
    footScore: '—',
    footUnit: ' 分',
    footLevel: '尚未开始评价',
  },

  onLoad() {
    this.scores = this.readStore(KEY);
    this.notes = this.readStore(NKEY);
    this.setData({ sections: this.buildSections() });
    this.refreshAll();
  },

  readStore(key) {
    try {
      return wx.getStorageSync(key) || {};
    } catch (e) {
      return {};
    }
  },

  /** 把 120 条指标按 section → sub 摊成 wxml 能直接循环的三层结构。 */
  buildSections() {
    return DATA.sections.map((sec, si) => {
      const inSection = DATA.indicators.filter((ind) => ind.section === sec.name);
      const subs = (sec.subs && sec.subs.length ? sec.subs : [{ name: '' }])
        .map((sub) => ({
          name: sub.name,
          visible: true,
          inds: inSection
            .filter((ind) => (sub.name ? ind.sub === sub.name : true))
            .map((ind) => {
              const score = this.scores[ind.id];
              return {
                id: ind.id,
                code: ind.code,
                title: ind.title,
                r1: ind.r1 || '—',
                r3: ind.r3 || '—',
                r5: ind.r5 || '—',
                score: score || 0,
                chipText: chipText(score),
                chipCls: chipCls(score),
                needEvi: score === 1 || score === 5,
                open: false,
                rubOpen: false,
                note: this.notes[ind.id] || '',
                eviCount: 0,
                visible: true,
              };
            }),
        }))
        .filter((sub) => sub.inds.length);

      return { idx: si + 1, name: sec.name, subs, open: false, visible: true, scored: 0, total: inSection.length, avg: '—' };
    });
  },

  /* ── 交互 ──────────────────────────────────────────────────────────── */

  onToggleSection(e) {
    const si = e.currentTarget.dataset.si;
    this.setData({ [`sections[${si}].open`]: !this.data.sections[si].open });
  },

  onToggleInd(e) {
    const p = this.path(e);
    this.setData({ [`${p}.open`]: !this.indAt(e).open });
  },

  onToggleRub(e) {
    const p = this.path(e);
    this.setData({ [`${p}.rubOpen`]: !this.indAt(e).rubOpen });
  },

  onScoreTap(e) {
    const ind = this.indAt(e);
    const tapped = Number(e.currentTarget.dataset.score);
    // 再点一次同一个分数就取消，和原型一致
    const score = ind.score === tapped ? 0 : tapped;

    if (score) this.scores[ind.id] = score;
    else delete this.scores[ind.id];

    const p = this.path(e);
    this.setData({
      [`${p}.score`]: score,
      [`${p}.chipText`]: chipText(score),
      [`${p}.chipCls`]: chipCls(score),
      [`${p}.needEvi`]: score === 1 || score === 5,
    });
    this.persist(KEY, this.scores);
    this.refreshAll();
  },

  onNoteInput(e) {
    const ind = this.indAt(e);
    this.notes[ind.id] = e.detail.value;
    this.persist(NKEY, this.notes);
  },

  onAddEvidence(e) {
    const p = this.path(e);
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: (res) => this.setData({ [`${p}.eviCount`]: res.tempFiles.length }),
    });
  },

  onFilterTap(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
    this.applyFilter();
  },

  onSave() {
    this.persist(KEY, this.scores);
    this.persist(NKEY, this.notes);
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  /* ── 工具 ──────────────────────────────────────────────────────────── */

  path(e) {
    const { si, bi, ii } = e.currentTarget.dataset;
    return `sections[${si}].subs[${bi}].inds[${ii}]`;
  },

  indAt(e) {
    const { si, bi, ii } = e.currentTarget.dataset;
    return this.data.sections[si].subs[bi].inds[ii];
  },

  persist(key, value) {
    try {
      wx.setStorageSync(key, value);
    } catch (err) {
      /* 存不进去就算了，和原型一样静默 */
    }
  },

  refreshAll() {
    this.refreshSummary();
    this.refreshCounts();
    this.refreshSectionMeta();
    this.applyFilter();
  },

  refreshSummary() {
    const ids = Object.keys(this.scores).filter((k) => this.scores[k] >= 1);
    const sum = ids.reduce((acc, k) => acc + this.scores[k], 0);
    const n = ids.length;
    const ratio = n ? sum / (n * 5) : 0;
    const pct = Math.round(ratio * 100);

    this.setData({
      dialPct: n ? pct : 0,
      dialText: n ? `${pct}%` : '—',
      sumLevel: n ? levelOf(ratio) : '未开始',
      sumCount: `已评 ${n} / ${TOOL.itemCount} 项 · ${TOOL.code} v${TOOL.version}`,
      barPct: Math.round((n / TOOL.itemCount) * 100),
      footScore: n ? String(pct) : '—',
      footUnit: n ? ' 分（得分率）' : ' 分',
      footLevel: n ? `总体等级：${levelOf(ratio)} · 有效评价 ${n} 项` : '尚未开始评价',
    });
  },

  refreshCounts() {
    const keys = Object.keys(this.scores);
    const scored = keys.filter((k) => this.scores[k] >= 1).length;
    const low = keys.filter((k) => this.scores[k] >= 1 && this.scores[k] <= 2).length;
    this.setData({
      'filters[0].count': TOOL.itemCount,
      'filters[1].count': TOOL.itemCount - scored,
      'filters[2].count': low,
    });
  },

  refreshSectionMeta() {
    const patch = {};
    this.data.sections.forEach((section, si) => {
      const all = [].concat(...section.subs.map((sub) => sub.inds));
      const scored = all.filter((ind) => this.scores[ind.id] >= 1);
      const avg = scored.length
        ? (scored.reduce((acc, ind) => acc + this.scores[ind.id], 0) / scored.length).toFixed(1)
        : '—';
      patch[`sections[${si}].scored`] = scored.length;
      patch[`sections[${si}].avg`] = avg;
    });
    this.setData(patch);
  },

  /**
   * 筛选。口径照抄原型：
   *   all  全显示，分组的展开状态不动
   *   todo 只留未评的；low 只留 1–2 分的
   *   非 all 模式下，有命中项的分组自动展开，没命中的整块隐藏
   */
  applyFilter() {
    const mode = this.data.mode;
    const patch = {};
    let anyVisible = false;

    this.data.sections.forEach((section, si) => {
      let visibleInSection = 0;

      section.subs.forEach((sub, bi) => {
        let visibleInSub = 0;
        sub.inds.forEach((ind, ii) => {
          const score = this.scores[ind.id];
          const show = mode === 'all' ? true
            : mode === 'todo' ? !(score >= 1)
              : score >= 1 && score <= 2;
          patch[`sections[${si}].subs[${bi}].inds[${ii}].visible`] = show;
          if (show) visibleInSub += 1;
        });
        patch[`sections[${si}].subs[${bi}].visible`] = mode === 'all' || visibleInSub > 0;
        visibleInSection += visibleInSub;
      });

      if (mode === 'all') {
        patch[`sections[${si}].visible`] = true;
      } else {
        patch[`sections[${si}].visible`] = visibleInSection > 0;
        patch[`sections[${si}].open`] = visibleInSection > 0;
      }
      if (visibleInSection) anyVisible = true;
    });

    patch.emptyText = mode !== 'all' && !anyVisible
      ? (mode === 'todo' ? `全部 ${TOOL.itemCount} 项均已评价 🎉` : '暂无低分（1–2 分）指标')
      : '';

    this.setData(patch);
  },
});
