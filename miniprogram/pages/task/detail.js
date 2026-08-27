/**
 * 任务详情页 — APP-STRUCTURE.md screen id `TaskDetail`.
 *
 * Read-only (ticket 10). Requirements, deadline and the material already filed,
 * so a teacher does not have to ask anyone what a task actually wants.
 *
 * ── 2026-08-27：「任务操作」那一节按原型补回 ─────────────────────────────────
 *
 * 此前这一页一个写入控件也没有，原型的 接受／完成 两枚被换成了一块只读的「任务进度」。
 * 园方裁定以原型为准之后，两枚都画回来：
 *
 *   接受   真写入。a1 → a2，**无请求体**，不携带任何用户内容，所以不过内容安全闸门
 *          （ADR-0016 只管带内容的写入）。
 *   完成   点得下去，但办不成。它与「提交材料」共用 `POST /tasks/{id}/completion`，
 *          两者怎么分工在任何一份权威里都没定（G40），点了就说这一句 —— 园方
 *          2026-08-27 裁定：画不出的控件照画，点了说明原因。
 *
 * 「提交材料」仍是**入口**，不是控件：完整预览＋明确发布那一套在提交页上
 * （ADR-0016 的 HUMAN_PREVIEW_CONFIRM，一枚按钮承不起）。
 *
 * §2.3: a task outside the caller's scope comes back 404, identical to one that
 * never existed. The wording is the registry's, through reportFailure.
 */

const guard = require('../../utils/guard');
const identity = require('../../services/identity');
const task = require('../../services/task');
const taskSubmit = require('../../services/task-submit');
const { reportFailure } = require('../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    taskId: 0,
    task: null,
    accepting: false,
    // 「完成」点下去之后就地写出的一句理由。不弹窗：这一页已经有位置说话了。
    opNotice: '',
    submitDisabled: true,
    submitReason: '',
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const taskId = Number(query.task_id);
    if (!taskId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少任务编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, taskId });
    this.load(taskId);
  },

  /**
   * 从提交页返回时重读（票据 11）。
   *
   * 「提交成功后详情的状态立即更新，无需手工刷新」的落点就是这里。首次进入时
   * onLoad 已经读过一遍，而平台的顺序是 onLoad 先于 onShow —— `entered` 让第一次
   * onShow 只做记号，不重复发一次请求。
   */
  onShow() {
    if (!this.entered) {
      this.entered = true;
      return;
    }
    if (this.data.taskId) return this.load(this.data.taskId);
  },

  onRetryLoad() {
    if (!this.data.taskId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.taskId);
  },

  async load(taskId) {
    try {
      const row = await task.detail(taskId);
      // The term state is first-class (ticket 06): this page reads what
      // termState() decided and never inspects the term enum itself.
      const entry = task.submitEntry({
        taskStatus: row.task_status,
        canWrite: identity.termState().canWrite,
      });
      this.setData({
        task: row,
        submitDisabled: entry.disabled,
        submitReason: entry.reason,
        loading: false,
      });
      if (row.task_title) {
        wx.setNavigationBarTitle({ title: row.task_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onSubmitTap() {
    // Disabled entries explain themselves where they stand; a tap must not
    // become a second, louder refusal.
    if (this.data.submitDisabled) return;
    task.openSubmit(this.data.taskId);
  },

  /**
   * 接受任务（a1 → a2）。无请求体，不携带内容，因此不过内容安全闸门。
   *
   * 幂等键按「一次逻辑尝试」生成一次并留在页面上：重复点击复用同一个，服务端按 §4.2
   * 原样回第一次的结果，不会因为手抖变成两次接受。
   */
  async onAcceptTap() {
    if (this.data.accepting || !this.data.task) return;
    if (this.data.task.assign_status !== 'a1') return;   // 已接受的再点是无操作

    const acceptKey = this.acceptKey || taskSubmit.newAttemptKey();
    this.acceptKey = acceptKey;
    this.setData({ accepting: true, opNotice: '', errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      await taskSubmit.accept(this.data.taskId, { idempotencyKey: acceptKey });
      this.setData({ accepting: false });
      await this.load(this.data.taskId);
    } catch (err) {
      reportFailure(this, err, { accepting: false });
    }
  },

  /**
   * 「完成」—— 原型有这枚按钮，契约给不出它。
   *
   * `POST /tasks/{task_id}/completion` 只有一个：它同时是「提交材料」的落点。哪一步
   * 算完成、材料是不是必须，`db/GAPS.md` G40 记着还没定。所以这里不发请求，就地说明。
   */
  onCompleteTap() {
    this.setData({
      opNotice: '「完成」还没有开放：它与下面的「提交材料」是同一个动作，先提交材料，任务就转为已完成。',
    });
  },

  /**
   * 任务附件的「预览」「下载」—— 同样是原型有、契约还给不出的一对。
   * 资源与案例有 `/download-link`，任务附件没有对应端点（G40）。
   */
  onFileTap() {
    this.setData({ opNotice: '任务附件的预览与下载还没有开放，园所会另行发送这些材料。' });
  },
});
