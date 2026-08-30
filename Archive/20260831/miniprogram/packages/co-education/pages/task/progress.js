/**
 * 教师查看完成进度 — APP-STRUCTURE.md screen id `TaskProgress`（票据 19）。
 *
 * ── 这一页是只读的，而且是**结构上**只读 ────────────────────────────────────
 *
 * 「进度页本身只读，不出现补录或代填入口」（票据 19 验收项）。落实成三件事，缺一都不算：
 *
 *   1. `hl-progress-grid` 的 `tappable` 在这里**不给**（默认 false），所以格子点不动。
 *   2. 本文件**没有任何写入调用** —— 没有 create、没有 patch、没有 publish。
 *   3. 家长交的东西教师本来就不该替他交：`db_parent_task_submission` 的作者是家长，
 *      教师端连那个端点都没有。在园时光的进度页可以点进表单，是因为那是教师自己写的
 *      内容；这一页不是，所以两页的 `tappable` 不同，不是疏忽。
 *
 * ── 整取不分页 ──────────────────────────────────────────────────────────────
 *
 * 完成情况按幼儿逐行整体返回，**请求里不带任何分页参数**（§3.5）。落点在
 * `services/co-education.taskSubmissions` -> `api.getRoster`，它与 `getPage` 的全部差别
 * 就是不发 `limit` 也不发 `cursor`。行序按 `child_id ASC`，服务端定，客户端不重排。
 *
 * ⚠ `openapi.yaml` 在这条路径上声明了 `limit` 与 `cursor` 两个参数，与它自己的
 * `x-hualong-sort: child_id ASC` 和 §3.5 相矛盾。契约正文是权威，所以这里整取。
 * 这条自相矛盾记进交接。
 */

const guard = require('../../../../utils/guard');
const coEdu = require('../../../../services/co-education');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,

    parentTaskId: 0,
    taskTitle: '',
    statusLabel: '',

    columns: [],
    rows: [],
    doneCount: 0,
    totalCount: 0,
    summary: '',

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const parentTaskId = Number(query.parent_task_id) || 0;
    if (!parentTaskId) {
      this.setData({ ready: true, loading: false, errorText: '缺少任务编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, parentTaskId });
    // 返回 promise：平台忽略它，但测试要等它读完，不必靠 sleep 猜时机。
    return this.load(parentTaskId);
  },

  onRetryLoad() {
    if (!this.data.parentTaskId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.parentTaskId);
  },

  async load(parentTaskId) {
    try {
      const [task, rows] = await Promise.all([
        coEdu.taskDetail(parentTaskId),
        coEdu.taskSubmissions(parentTaskId),
      ]);
      const doneCount = rows.filter((r) => r.done).length;
      this.setData({
        loading: false,
        taskTitle: task.parent_task_title,
        statusLabel: coEdu.TASK_STATUS[task.publish_status] || '未知状态',
        doneCount,
        totalCount: rows.length,
        summary: `全班 ${rows.length} 名幼儿，已提交 ${doneCount} 名，未提交 ${rows.length - doneCount} 名。`,
        // 同一个网格，只有一列 —— 它不知道自己在渲染哪个模块。
        ...coEdu.taskProgressMatrix(rows),
      });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onBackTap() {
    wx.navigateBack();
  },
});
