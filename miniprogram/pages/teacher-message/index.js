/**
 * 教师寄语 —— 接 `GET /teacher-messages` 与两条提交（services/assessment.js）。
 *
 * 「添加到」选**全体幼儿**走 `POST /teacher-messages`（全班扇出，缺行插、已有跳）；
 * 选**具体幼儿**走 `PUT /children/{child_id}/teacher-message`（只生成一条）。
 *
 * 【提交后永久只读】（F16 第二点 / `docs/DO-NOT-BUILD.md` 第 16 条）：已完成的圆点
 * 点进去是 `teacher-message-detail`（只读），**不出编辑器**。原型那个「把上方添加到
 * 切到那个幼儿」的行为只对未完成的圆点保留 —— 对已完成的圆点做同样的事就等于给了
 * 一条重新编辑的路，而服务端会回 409，本表也没有任何改法。
 *
 * 【下拉的第一项是「全体幼儿」，其余是本班名单】。名单不另取一次名册：服务端的进度
 * 看板已经按当前班 `e1` 名册左连接过了，`items` 就是整份名册。再取一次会造出两份可能
 * 不一致的名单。
 *
 * 【指纹原样带着走】：`rosterFingerprint` 从看板拿到、原样交回 service，页面
 * **不解析、不重算、不比较**。名册漂移时服务端回 409，这里重取一次看板再让教师确认。
 */

const assess = require('../../services/assessment.js');

/** 下拉第一项永远是「全体幼儿」，`childId` 为 null 就是「走 POST 那一条」。 */
const ALL_TARGET = { childId: null, name: '全体幼儿' };

Page({
  data: {
    targets: [ALL_TARGET],
    targetIndex: 0,
    text: '',
    focusInput: false,

    rows: [],
    summary: { total: 0, done: 0, undone: 0 },
    /** 服务端算的名册指纹，不透明串。页面只在提交时原样交回去，WXML 不用它。 */
    rosterFingerprint: null,
    /** 无进行中学期，或名册为空。两者都禁用提交。 */
    canSubmit: false,
    /**
     * 有进行中学期。禁用提交有两个原因，这一个把它们分开。
     *
     * 只看 `canSubmit` 会把「本班在园名册是空的」也说成「当前不在学期内」，
     * 而那句话是假的 —— 学期在，只是没有对象可写。
     */
    hasTerm: false,
    /** 提交进行中，挡住连点 —— 这两条动作都是单向的。 */
    submitting: false,
  },

  /** 从详情页返回也重新取：那一页不写库，但同班配班教师可能刚提交过。 */
  onShow() {
    this.refresh();
  },

  async refresh() {
    try {
      const board = await assess.messageBoard();
      this.setData({
        rows: board.rows,
        summary: board.summary,
        canSubmit: board.canSubmit,
        hasTerm: Boolean(board.termId),
        // 已完成的幼儿仍留在下拉里：选中他再提交会拿到 409 与那句「永久只读」，
        // 那比「他从名单上消失了」更容易看懂。
        targets: [ALL_TARGET, ...board.rows.map((r) => ({ childId: r.childId, name: r.name }))],
        targetIndex: 0,
        rosterFingerprint: board.rosterFingerprint,
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '进度加载失败，请稍后重试', icon: 'none' });
    }
  },

  onTargetChange(e) {
    this.setData({ targetIndex: Number(e.detail.value) });
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (!this.data.canSubmit) {
      wx.showToast({
        title: this.data.hasTerm
          ? '本班在园名册是空的，没有可写寄语的幼儿'
          : '当前不在学期内，寄语要在学期中提交',
        icon: 'none',
      });
      return;
    }
    // 预检文案由 service 给，页面不自己判长度 —— 上限的权威在 DDL，不在这里。
    const why = assess.whyCannotSubmitTeacherMessage({ content: this.data.text });
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    const target = this.data.targets[this.data.targetIndex] || ALL_TARGET;
    this.setData({ submitting: true });
    try {
      const done = target.childId === null
        ? await this.submitForClass()
        : await this.submitForChild(target);
      wx.showToast({ title: done, icon: 'none' });
      this.setData({ text: '' });
    } catch (err) {
      wx.showToast({ title: assess.messageFailureText(err), icon: 'none' });
      // 名册漂移是唯一一种「重取之后就能再试」的失败，其余重取无害。
      if (err && err.code === 'fingerprint_drift') await this.refresh();
    } finally {
      this.setData({ submitting: false });
    }
    await this.refresh();
  },

  /** 全班扇出。`insertedCount` 为 0 也是成功（全班都已有行），照实说清。 */
  async submitForClass() {
    const out = await assess.submitTeacherMessagesForClass({
      content: this.data.text,
      rosterFingerprint: this.data.rosterFingerprint,
    });
    if (!out.insertedCount) return '全班本学期都已提交，没有新增';
    return `已为 ${out.insertedCount} 名幼儿提交寄语`;
  },

  async submitForChild(target) {
    await assess.submitTeacherMessage(target.childId, { content: this.data.text });
    return `已为 ${target.name} 提交寄语`;
  },

  onDotTap(e) {
    const { childId, childName, done } = e.currentTarget.dataset;
    if (done) {
      // 只读详情。**不切「添加到」、不聚焦输入框** —— 那条路会通向一个必定 409 的提交。
      wx.navigateTo({
        url: `/pages/teacher-message-detail/index?childId=${childId}`
          + `&childName=${encodeURIComponent(childName)}`,
      });
      return;
    }
    const i = this.data.targets.findIndex((t) => t.childId === Number(childId));
    this.setData({ targetIndex: i > -1 ? i : 0, focusInput: true });
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    wx.showToast({ title: `请为 ${childName} 填写寄语`, icon: 'none' });
  },
});
