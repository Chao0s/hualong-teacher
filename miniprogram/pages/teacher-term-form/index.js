/**
 * 填写学期评价 —— 接 `GET/PUT /children/{child_id}/term-evaluation`
 * （services/assessment.js）。
 *
 * **一次写成 c1，没有草稿**：`db_term_eval` 的值域只有 c1 / c2，而全库没有任何决议
 * 为它定义服务端草稿，所以「保存」就是提交。提交过的进只读态。
 *
 * **照片区本轮不接。** 契约的 `file_id[]` 要的是「该幼儿专属相册里的既有 file_id」，
 * 而 `GET /children/{child_id}/term-evaluation` 现在不回 `file_id`（服务端漂移，
 * 由 #30 修）—— 没有数据源就不要渲染它，更不要编一个出来。原型那份按月分组的
 * 假相册因此删掉，入口留着并置灰，写明待接入。
 */

const assess = require('../../services/assessment.js');

Page({
  data: {
    // 名册整份（真名册，不是写死的三个名字）。picker 的 range 是名字数组。
    rows: [],
    children: [],
    childIndex: 0,
    childId: null,

    content: '',
    textMax: assess.TERM_EVAL_TEXT_MAX,
    statusLabel: '',
    submittedLabel: '—',
    readonly: false,

    // 照片区：一张都不渲染，见文件头注。
    imported: [],
    photoHint: '照片导入待接入',

    albumOpen: false,
    albumTitle: '',
    groups: [],
    picked: [],
    confirmText: '导入',
  },

  async onLoad(options) {
    if (options.view) wx.setNavigationBarTitle({ title: '学期评价详情' });
    const wanted = Number(options.childId) || null;
    try {
      const board = await assess.termEvaluationBoard();
      let index = board.rows.findIndex((row) => row.childId === wanted);
      if (index < 0) index = 0;
      this.setData({
        rows: board.rows,
        children: board.rows.map((row) => row.name),
        childIndex: index,
      });
      await this.loadChild();
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '加载失败，请返回重试', icon: 'none' });
    }
  },

  /**
   * 取这名幼儿本人写的那一列。**无行不是错误，是「还没写过」** ——
   * service 回 null，这里进空白填写态。
   */
  async loadChild() {
    const row = this.data.rows[this.data.childIndex];
    if (!row) return;
    const detail = await assess.getTermEvaluation(row.childId);
    this.setData({
      childId: row.childId,
      content: detail ? detail.text : '',
      statusLabel: detail ? detail.statusLabel : '未完成',
      submittedLabel: detail ? detail.submittedLabel : '—',
      // 提交过就不能再改（`term_eval.submit` 是 one-way，NONE→c1）。
      readonly: Boolean(detail && detail.done),
    });
  },

  async onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value) });
    try {
      await this.loadChild();
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '加载失败，请稍后重试', icon: 'none' });
    }
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  /** 照片导入没有数据源，入口留着但不打开浮层，点一下说明原因。 */
  onOpenAlbum() {
    wx.showToast({ title: this.data.photoHint, icon: 'none' });
  },

  syncTitle() {
    this.setData({ albumTitle: `${this.data.children[this.data.childIndex]}的月度评价相册` });
  },

  onTogglePhoto(e) {
    const label = e.currentTarget.dataset.label;
    const picked = this.data.picked.includes(label)
      ? this.data.picked.filter((x) => x !== label)
      : this.data.picked.concat(label);
    this.setData({ picked, confirmText: picked.length ? `导入（${picked.length}）` : '导入' });
  },

  onConfirmAlbum() {
    if (!this.data.picked.length) return;
    const imported = this.data.imported.slice();
    this.data.picked.forEach((label) => {
      if (!imported.includes(label)) imported.push(label);
    });
    this.setData({ imported, albumOpen: false, picked: [] });
  },

  onCloseAlbum() {
    this.setData({ albumOpen: false, picked: [] });
  },

  onRemoveImported(e) {
    const label = e.currentTarget.dataset.label;
    this.setData({ imported: this.data.imported.filter((x) => x !== label) });
  },

  async onSave() {
    if (this.data.readonly) {
      wx.showToast({ title: '这名幼儿的学期评价已提交，不能再改', icon: 'none' });
      return;
    }
    const why = assess.whyCannotSubmitTermEvaluation({ text: this.data.content });
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    try {
      // 请求体只有 eval_text —— term_id / teacher_id / 状态 / 时间全是服务端派生的，
      // 而 TermEvaluationWrite 是 additionalProperties:false，多发一个键回 422。
      await assess.submitTermEvaluation(this.data.childId, { text: this.data.content });
      wx.showToast({ title: '学期评价已提交', icon: 'none' });
      wx.navigateBack();
    } catch (err) {
      wx.showToast({ title: assess.termEvalFailureText(err), icon: 'none' });
    }
  },
});
