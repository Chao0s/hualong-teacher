/**
 * 任务详情页 — APP-STRUCTURE.md screen id `TaskDetail`.
 *
 * Read-only (ticket 10). Requirements, deadline and the material already filed,
 * so a teacher does not have to ask anyone what a task actually wants.
 *
 * NO WRITE CONTROLS. The prototype carries 接受 / 完成 / 提交材料 buttons; all
 * three are writes with their own gate path, and ticket 11 builds them. What
 * this page shows is an ENTRY to that screen, disabled with its reason when the
 * task is closed or the term is out (criterion 5). An entry is a doorway, not a
 * control: nothing here submits, edits or deletes.
 *
 * §2.3: a task outside the caller's scope comes back 404, identical to one that
 * never existed. The wording is the registry's, through reportFailure.
 */

const guard = require('../../utils/guard');
const identity = require('../../services/identity');
const task = require('../../services/task');
const { reportFailure } = require('../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    taskId: 0,
    task: null,
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
    task.openSubmit();
  },
});
