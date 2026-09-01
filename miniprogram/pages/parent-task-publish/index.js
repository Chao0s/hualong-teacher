/**
 * 发布新任务 —— `POST /home-school/parent-tasks`（建草稿）、
 * `PATCH …/{id}`（改草稿）、`POST …/{id}/publication`（发布）。
 *
 * **带 `?id=` 进来就是改草稿**，不带就是新建。同一张表单两种用途：草稿只有 `s1`
 * 可改，而 `s1` 的表单与新建的表单是同一份，没有理由做两页。
 *
 * ── 两个按钮，因为契约是两步 ───────────────────────────────────────────────
 *
 *   存为草稿    只 `POST`（或 `PATCH`）。家长看不到 `s1`（§4 规则 2），可以慢慢改。
 *   发布给家长  先存，再 `POST …/publication`。发布前 `wx.showModal` 确认一次。
 *
 * 原型只有一个按钮「发布给家长」，点完却提示「已生成任务草稿」—— 按钮文字与结果
 * 不一致。契约两步都有，教师两件事都要做，所以给两个按钮，各自说清楚自己干什么。
 *
 * **发布失败不回滚草稿。** 草稿已经存住了，它会出现在列表里，改完日期再发一次即可 ——
 * 比「发布失败连内容也没了」好得多。
 *
 * ── 时间是原型漏掉的必填项 ─────────────────────────────────────────────────
 *
 * `db_parent_task.start_at` 是 `NOT NULL`，而原型的表单里根本没有时间输入框 ——
 * 那张表单在原型里提交不成功。必填以 DDL 为准（CLAUDE.md §4），所以这里补上
 * 「开始时间」（必填）与「截止时间」（可空）两组 picker。
 *
 * 组装走 `services/co-education.taskWireTime()`：`+08:00` 是**字面量不是换算**，
 * 页面不拼时间戳。发布时服务端按 `start_at` 派生 `term_id`，落不进任何学期就拒绝，
 * 那句 409 由 `publishFailureText()` 译成看得懂的一句。
 *
 * ── 切类型不再整套替换文案 ─────────────────────────────────────────────────
 *
 * 原型切「日常／社区」会把三个输入框整套换成该类型的示例文案。那是原型用来展示的
 * 假数据；在真表单里它会**抹掉教师已经写好的字**。这里切类型只改类型，不动正文。
 *
 * DO-NOT-BUILD 12：亲子任务**不出现视频入口**，也不出现附件入口 ——
 * `ParentTaskWrite` 里没有 `file_id`，任务本身不带附件，附件在家长的提交上。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

Page({
  data: {
    types: [
      { key: 't1', title: '日常任务', desc: '家庭生活、亲子阅读、观察记录等日常经验。' },
      { key: 't2', title: '社区任务', desc: '基于社区建筑、见闻或公共空间建立任务。' },
    ],
    type: 't1',
    title: '',
    background: '',
    detail: '',

    startDate: '',
    startClock: '08:00',
    dueDate: '',
    dueClock: '18:00',

    limits: co.TASK_LIMITS,
    editing: false,          // 带 id 进来的是改草稿
    loading: true,
    error: '',
    saving: false,
  },

  async onLoad(query) {
    this.taskId = (query && query.id) || null;
    try {
      await guard.requireSession();
      if (this.taskId) {
        await this.loadDraft();
      } else {
        // 新建：开始时间默认园所今天 08:00，截止留空（`due_at` 可空）。
        const parts = co.taskPickerParts(co.defaultTaskStart(Date.now()));
        this.setData({
          startDate: parts.date,
          startClock: parts.clock,
          loading: false,
        });
      }
      wx.setNavigationBarTitle({ title: this.taskId ? '编辑草稿' : '发布新任务' });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({ loading: false, error: err.userMessage || '加载失败，请稍后重试' });
    }
  },

  /** 回填草稿。非 `s1` 的任务改不动，服务端会回 409，这里先挡住并说清楚。 */
  async loadDraft() {
    const task = await co.getTask(this.taskId);
    if (!task.can.edit) {
      this.setData({
        loading: false,
        error: `这个任务是「${task.statusLabel}」，内容已经不能修改了`,
      });
      return;
    }
    const start = co.taskPickerParts(task.startAt);
    const due = co.taskPickerParts(task.dueAt);
    this.setData({
      editing: true,
      type: task.type,
      title: task.title,
      background: task.background,
      detail: task.detail,
      startDate: start.date,
      startClock: start.clock || '08:00',
      dueDate: due.date,
      dueClock: due.clock || '18:00',
      loading: false,
    });
  },

  onRetry() {
    this.onLoad(this.taskId ? { id: this.taskId } : {});
  },

  onTypeTap(e) {
    // 只改类型。**不动已经写好的正文** —— 原型那套「整套替换示例文案」会抹掉教师的字。
    this.setData({ type: e.currentTarget.dataset.key });
  },

  onInput(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },

  onStartDate(e) { this.setData({ startDate: e.detail.value }); },
  onStartClock(e) { this.setData({ startClock: e.detail.value }); },
  onDueDate(e) { this.setData({ dueDate: e.detail.value }); },
  onDueClock(e) { this.setData({ dueClock: e.detail.value }); },

  /** 截止时间可空，所以给一个清掉它的入口 —— 设了之后没法取消才是问题。 */
  onClearDue() {
    this.setData({ dueDate: '' });
  },

  /** 表单 → service 的写入形状。`dueAt` 为 null 表示不设截止／清空。 */
  formValues() {
    const { startDate, startClock, dueDate, dueClock } = this.data;
    return {
      type: this.data.type,
      title: this.data.title,
      background: this.data.background,
      detail: this.data.detail,
      startAt: startDate ? co.taskWireTime(startDate, startClock) : '',
      dueAt: dueDate ? co.taskWireTime(dueDate, dueClock) : null,
    };
  },

  /**
   * 存草稿。回 `parent_task_id` —— 新建之后这一页就变成「改草稿」，
   * 再点一次不会又建一条。
   */
  async saveDraft(form) {
    if (this.taskId) {
      await co.updateTaskDraft(this.taskId, form);
      return this.taskId;
    }
    const created = await co.createTaskDraft(form);
    this.taskId = created.id;
    this.setData({ editing: true });
    return created.id;
  },

  async onSaveDraft() {
    if (this.data.saving) return;
    const form = this.formValues();
    const missing = co.whyCannotSaveTask(form);
    if (missing) {
      wx.showToast({ title: missing, icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '正在保存', mask: true });
    try {
      await this.saveDraft(form);
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '保存失败，请稍后重试', icon: 'none' });
    }
  },

  async onPublish() {
    if (this.data.saving) return;
    const form = this.formValues();
    const missing = co.whyCannotSaveTask(form);
    if (missing) {
      wx.showToast({ title: missing, icon: 'none' });
      return;
    }
    const confirmed = await this.confirmPublish(form);
    if (!confirmed) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '正在发布', mask: true });
    try {
      // 两步：先把内容存住，再转状态。第二步失败时草稿还在，改完再发一次即可。
      const id = await this.saveDraft(form);
      await co.publishTask(id);
      wx.hideLoading();
      this.setData({ saving: false });
      wx.showToast({ title: '已发布', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      wx.hideLoading();
      this.setData({ saving: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      // 发布这一步的两个 409 有各自的说法，交给 service 的文案表。
      wx.showToast({ title: co.publishFailureText(err), icon: 'none' });
    }
  },

  /** 确认弹窗。resolve(true) 才继续发。 */
  confirmPublish(form) {
    const typeLabel = co.TASK_TYPE[form.type] || '';
    const due = form.dueAt ? `${form.dueAt.slice(0, 16).replace('T', ' ')} 截止` : '不设截止';
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认发布？',
        content: `${typeLabel}任务《${form.title.trim()}》\n`
          + `${form.startAt.slice(0, 16).replace('T', ' ')} 开始，${due}。\n`
          + '发布后家长即可看到，时间与正文不能再修改。',
        confirmText: '确认发布',
        cancelText: '再看看',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
  },
});
