/**
 * 质量评估 —— 接 `GET /assessments`、`GET /assessments/{id}` 与
 * `PUT /assessments/{id}/items/{tool_item_code}`（services/assessment.js）。
 *
 * 题库 120 条在 `./assessment-data.js`（F17 的版本化代码资产，一个字不改）。
 * `ind.code`（`I001`）就是契约的 `tool_item_code`，与库里逐字相同，不用换算 ——
 * 所以本页的分数与评价记录**都按 `ind.code` 存**，不按 `ind.id`（那是 DDL 里
 * `db_assessment_item` 的整数代理键，两张表同名一列含义不同）。
 *
 * 【本页不创建评估】。契约明写 `NONE→s1` 没有任何决议指定谁建、何时建。
 * 进来时取 `GET /assessments` 的第一份（契约的排序是 period DESC, id DESC，
 * 客户端不重排），或者用 `?assessmentId=` 指定。`s3`（已完成）进只读态 ——
 * 契约里没有 `s3→*` 的任何转移。
 *
 * 【「再点一次取消评分」去掉了】。读写值域不对称是真的：`AssessmentItem.score`
 * 可 null，`AssessmentItemWrite.score` **必须 1—5** —— 用 PUT 把分抹掉在契约上
 * 没有出路。
 *
 * 【得分率与等级是纯客户端派生】。契约与 DDL 里没有 `ratio`、没有等级、没有
 * `levels`；`db_assessment` 只有 `completed_count` / `required_count` /
 * `assessment_status`。算在 service 的 `scoreRate()` 里，页面不再算一遍。
 *
 * 【评价记录暂存本机】。service 照契约把 `note` 发上去，但**服务端的 INSERT 只有
 * 三列，收下就丢**（实测库里 1176 行 note 全为 NULL，由 #30 修）。所以这里同时把它
 * 写进本机存储，输入框旁标明。存储键按 `tool_item_code`。
 *
 * 【佐证图片本轮不接】。契约的 `file_id[]` 要 `POST /media/files` 先落库，而
 * `GET /assessments/{id}` 的 items 现在不回 `file_id` —— 入口留着并置灰。
 */

const DATA = require('./assessment-data.js');
const assess = require('../../services/assessment.js');

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

/** 本机存的评价记录，键是 `tool_item_code`。评估一换就换一个键。 */
function noteKey(assessmentId) {
  return `hualong_assessment_notes_${assessmentId}`;
}

Page({
  data: {
    options: OPTIONS,
    label1: LABELS[1],
    label3: LABELS[3],
    label5: LABELS[5],

    assessmentId: null,
    periodLabel: '',
    scopeLabel: '',
    statusLabel: '',
    readonly: false,
    // 分数与评价记录一起 PUT 上去（service 照契约发），但服务端只落分数、丢掉
    // 评价记录（#30）。所以这一句写的是「服务端暂未保存」，不是「尚未上传」。
    noteHint: '评价记录暂存本机，服务端暂未保存',
    eviHint: '佐证图片待接入',

    sections: [],
    mode: 'all',
    filters: [
      { key: 'all', label: '全部', count: 0 },
      { key: 'todo', label: '未评', count: 0 },
      { key: 'low', label: '低分', count: 0 },
    ],
    emptyText: '',

    dialPct: 0,
    dialText: '—',
    sumLevel: '未开始',
    sumCount: '',
    barPct: 0,
    footScore: '—',
    footUnit: ' 分',
    footLevel: '尚未开始评价',
  },

  async onLoad(options) {
    this.scores = {};
    this.notes = {};
    this.required = DATA.indicators.length;
    try {
      const page = await assess.listAssessments({ limit: 20 });
      const id = Number(options.assessmentId) || (page.items[0] && page.items[0].id);
      if (!id) {
        wx.showToast({ title: '还没有分配给你的质量评估', icon: 'none' });
        return;
      }
      const detail = await assess.getAssessment(id, LEVELS);
      // 未评的题**没有分**（items 里可能有行但 score 为 null）。这里只把有分的搬进来，
      // 不用 `|| 0` 兜底 —— 0 分在契约里不存在（CHECK 1..5）。
      detail.items.forEach((cell, code) => {
        if (cell.score !== null) this.scores[code] = cell.score;
      });
      this.notes = this.readStore(noteKey(id));
      // 服务端回过来的 note 优先（它是权威）；本机那份只补服务端还没接住的部分。
      detail.items.forEach((cell, code) => {
        if (cell.note) this.notes[code] = cell.note;
      });
      this.required = detail.requiredCount || DATA.indicators.length;
      this.assessmentId = id;
      this.setData({
        assessmentId: id,
        periodLabel: detail.period,
        scopeLabel: detail.scopeLabel,
        statusLabel: detail.statusLabel,
        readonly: !detail.can.score,
        sections: this.buildSections(),
      });
      this.refreshAll();
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '评估加载失败，请返回重试', icon: 'none' });
    }
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
              const score = this.scores[ind.code];
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
                note: this.notes[ind.code] || '',
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

  /**
   * 打一题分。**没有「再点一次取消」** —— `AssessmentItemWrite.score` 必须 1—5，
   * 用 PUT 把分抹掉在契约上没有出路。
   *
   * 先乐观更新那一格再落库（120 题逐题打分，每次等一个往返会很难用），
   * 落库失败把那一格退回去 —— 不能留一个只在屏幕上存在的分。
   */
  async onScoreTap(e) {
    if (this.data.readonly) {
      wx.showToast({ title: '这份评估已完成，不能再改分', icon: 'none' });
      return;
    }
    const ind = this.indAt(e);
    const score = Number(e.currentTarget.dataset.score);
    const before = ind.score;
    const why = assess.whyCannotScoreAssessmentItem({ score, note: this.notes[ind.code] });
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }

    const p = this.path(e);
    this.paint(p, score);
    this.scores[ind.code] = score;
    this.refreshAll();

    try {
      // note 照契约一起发上去（服务端现在收下就丢，见文件头注）。
      await assess.scoreAssessmentItem(this.assessmentId, ind.code, {
        score,
        note: this.notes[ind.code] || undefined,
      });
    } catch (err) {
      if (before) this.scores[ind.code] = before;
      else delete this.scores[ind.code];
      this.paint(p, before);
      this.refreshAll();
      wx.showToast({ title: assess.assessmentFailureText(err), icon: 'none' });
    }
  },

  /** 一格的四个显示值一起改。`score` 为 0 就是「未评」的显示态。 */
  paint(p, score) {
    this.setData({
      [`${p}.score`]: score || 0,
      [`${p}.chipText`]: chipText(score),
      [`${p}.chipCls`]: chipCls(score),
      [`${p}.needEvi`]: score === 1 || score === 5,
    });
  },

  /**
   * 评价记录只写本机。契约没有「只改 note」的端点（`score` 是 required），
   * 而服务端现在连随 score 发上去的那一份也不落库 —— 所以这里存本机，
   * 下一次打分时随 score 一起补发。输入框旁的 `noteHint` 写明了这一点。
   */
  onNoteInput(e) {
    const ind = this.indAt(e);
    this.notes[ind.code] = e.detail.value;
    this.persist(noteKey(this.assessmentId), this.notes);
  },

  /** 佐证图片没有接：契约要先 `POST /media/files` 落库，而详情不回 file_id。 */
  onAddEvidence() {
    wx.showToast({ title: this.data.eviHint, icon: 'none' });
  },

  onFilterTap(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
    this.applyFilter();
  },

  /** 分数每一题在点下去那一刻就 PUT 过了，这里只把本机那份评价记录写稳。 */
  onSave() {
    this.persist(noteKey(this.assessmentId), this.notes);
    wx.showToast({ title: `已评 ${Object.keys(this.scores).length} / ${this.required} 项`, icon: 'none' });
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

  /** 得分率与等级由 service 的 `scoreRate()` 算，页面不再算一遍。 */
  refreshSummary() {
    const items = Object.keys(this.scores).map((code) => ({ score: this.scores[code] }));
    const sum = assess.scoreRate(items, LEVELS);
    const n = sum.rated;
    const pct = sum.percent;

    this.setData({
      dialPct: n ? pct : 0,
      dialText: n ? `${pct}%` : '—',
      sumLevel: n ? sum.level : '未开始',
      sumCount: `已评 ${n} / ${this.required} 项 · ${this.data.periodLabel} ${this.data.statusLabel}`,
      barPct: Math.round((n / this.required) * 100),
      footScore: n ? String(pct) : '—',
      footUnit: n ? ' 分（得分率）' : ' 分',
      footLevel: n ? `总体等级：${sum.level} · 有效评价 ${n} 项` : '尚未开始评价',
    });
  },

  refreshCounts() {
    const keys = Object.keys(this.scores);
    const scored = keys.filter((k) => this.scores[k] >= 1).length;
    const low = keys.filter((k) => this.scores[k] >= 1 && this.scores[k] <= 2).length;
    this.setData({
      'filters[0].count': this.required,
      'filters[1].count': this.required - scored,
      'filters[2].count': low,
    });
  },

  refreshSectionMeta() {
    const patch = {};
    this.data.sections.forEach((section, si) => {
      const all = [].concat(...section.subs.map((sub) => sub.inds));
      const scored = all.filter((ind) => this.scores[ind.code] >= 1);
      const avg = scored.length
        ? (scored.reduce((acc, ind) => acc + this.scores[ind.code], 0) / scored.length).toFixed(1)
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
          const score = this.scores[ind.code];
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
      ? (mode === 'todo' ? `全部 ${this.required} 项均已评价 🎉` : '暂无低分（1–2 分）指标')
      : '';

    this.setData(patch);
  },
});
