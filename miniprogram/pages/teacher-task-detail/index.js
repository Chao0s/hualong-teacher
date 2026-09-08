/**
 * 任务详情（待办任务，首页那条线）—— 数据来自 `GET /tasks/{task_id}`，
 * 写动作是「接受」与「完成」。
 *
 * **不是 `parent-task-detail`**（亲子任务，家园社共育那条线）。两页的中文标题
 * 逐字相同，提到时必须写目录名。
 *
 * ── 屏幕上的状态是自己那一行的 `assign_status` ─────────────────────────────
 *
 * F28：`db_task.task_status` 与 `db_task_assign.assign_status` 互不派生。教师看到的
 * 徽章取 `assign.assign_status`，所以一位已经完成的教师不会在自己做完的事情上看到
 * 「待接收」。`task_status` 只决定两个按钮还在不在，**不进徽章**。
 *
 * ── 一次只给一个按钮 ───────────────────────────────────────────────────────
 *
 * `a1 → a2 → a3` 单向，没有 `a1 → a3` 这条边。所以 `a1` 只给「接受」、`a2` 只给
 * 「完成」，两个按钮不会同时出现 —— 先给按钮再被服务端 409 拒掉，是界面在说假话。
 * 状态真的在别处变了时（管理端刚取消它，或同一个人在另一台机器上点过），
 * `task.actionFailureText()` 说出是哪一种，页面随即整条重取。
 *
 * ── 原型的三块删掉了，不是漏了 ─────────────────────────────────────────────
 *
 *   分工要求的三行角色表   `db_task` 只有一列 `task_division`（`VARCHAR(300)`），
 *                          没有「大班组／中班组／教研组」这种逐行结构
 *   时间节点的三条时间线   只有 `due_at` 一个时间，三条节点是编出来的
 *   「提交材料」按钮       **三处都没有落点**（G89）：`db_task_assign` 一个文件列
 *                          都没有，契约的 task 族没有上传操作，`owner_object='db_task'`
 *                          的附件是管理端发下来、教师只读的那一份。教师能交上去的
 *                          只有 `db_task_assign.feedback`，它挂在「完成」上。
 *                          CLAUDE.md §8：没有数据源就不要渲染它。
 *
 * ── 附件区今天不会出现 ─────────────────────────────────────────────────────
 *
 * 服务端按 `owner_object='db_task'` 取附件，而数据集里这样的 `db_file_ref` 行有
 * **0 条**。所以 `files` 恒为空、附件区整块不渲染 —— 空的区块读起来像加载失败。
 *
 * ── 发起人那一枚角标今天也不会出现 ─────────────────────────────────────────
 *
 * `creator_type` 契约标必填，而 `GET /tasks/{task_id}` 的实作没有取这一列
 * （`db/GAPS.md` **G90**）。取不到就不画那一枚角标，**不写一个「未知发起人」
 * 顶上去**（CLAUDE.md §8）。服务端补齐之后它自己会出现，页面不用再改。
 */

const task = require('../../services/task');
const media = require('../../services/media');
const guard = require('../../utils/guard');

Page({
  data: {
    detail: null,
    feedback: '',
    feedbackMax: task.FEEDBACK_MAX,

    acting: false,
    loading: true,
    error: '',
  },

  onLoad(query) {
    this.taskId = Number(query.id) || 0;
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const detail = await task.getTask(this.taskId);
      this.setData({ detail, loading: false });
      wx.setNavigationBarTitle({ title: detail.title });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        detail: null,
        error: err.userMessage || '任务详情加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onFeedbackInput(e) {
    this.setData({ feedback: e.detail.value });
  },

  /**
   * 接受任务（`a1 → a2`）。**不弹确认。**
   *
   * 这一步登记表标 `one-way`，但它没有可后悔的一面：任务本来就派到了自己头上，
   * 接受只是把这件事记下来。要确认的是下面那一步。
   */
  onAccept() {
    return this.act('accept');
  },

  /**
   * 完成任务（`a2 → a3`）。**先确认。**
   *
   * `a3` 是终局，反馈随它一起冻结 —— 契约里没有第二条改反馈的端点。
   */
  async onComplete() {
    const why = task.whyCannotComplete(this.data.feedback);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '完成任务',
        content: '完成之后不能撤回，任务反馈也不能再改。确定完成吗？',
        confirmText: '完成',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (ok) await this.act('complete');
  },

  /**
   * 两个动作共用的这一段：发请求 → 整条重取 → 说一句。
   *
   * 成功之后**整条重取**，不本地推状态：按钮的显隐由服务端回的两列算出来
   * （`services/task.js` 的 `allowedActions()`），本地推一次就等于把那张状态表
   * 抄了第二份。
   *
   * 这里写模块名加函数名，**不写「点号加函数名」那种写法**：`scan-wiring.mjs:794`
   * 拿 `\.<名>\b` 在所有页面的 `index.js` 里找某个导出有没有人用，注释也算数、
   * 也不分是哪一个 service。`co-education.js` 与 `training.js` 各有一个同名导出，
   * 本页写成点号那种写法，它们的「导出但没有页面用到」两条就会一起消音。
   */
  async act(action) {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      if (action === 'accept') await task.accept(this.taskId);
      else await task.complete(this.taskId, this.data.feedback);
      const detail = await task.getTask(this.taskId);
      this.setData({ detail, acting: false, feedback: '' });
      wx.showToast({ title: action === 'accept' ? '已接受' : '已完成', icon: 'none' });
    } catch (err) {
      this.setData({ acting: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showModal({
        title: action === 'accept' ? '接受失败' : '完成失败',
        content: task.actionFailureText(err, action),
        showCancel: false,
      });
      // 多半是状态在别处变了，重取一次让按钮跟上。
      this.load();
    }
  },

  /**
   * 打开一份任务附件。
   *
   * 取档走 `GET /media/files/{file_id}/url`，宿主那一对由 service 给
   * （`db_task` + `task_id`）。服务端那一支只认自己那一行 assign，同事的任务附件
   * 取不到；`db_task` 不在供档事件表里，所以这一下**不记 `downloaded`**。
   */
  async onFileTap(e) {
    const fileId = Number(e.currentTarget.dataset.fileid);
    wx.showLoading({ title: '正在取档', mask: true });
    try {
      const r = await media.openFile(fileId, this.data.detail.fileOwner);
      wx.hideLoading();
      if (r.placeholder) {
        // 授权过了，但这个环境没有对象存储。说清楚是哪一件事，别让人以为没权限。
        wx.showModal({
          title: '取档授权已通过',
          content: r.reason,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      if (!r.opened) wx.showToast({ title: r.reason, icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '取档失败，请稍后重试', icon: 'none' });
    }
  },
});
