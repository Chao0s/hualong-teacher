/**
 * 亲子任务 · 任务详情 —— `GET /home-school/parent-tasks/{id}`
 * 与 `GET …/{id}/submissions`（完成情况看板）。
 *
 * ── 原型的两列删掉了，不是漏做 ─────────────────────────────────────────────
 *
 * 原型的表格有四列：幼儿、已读、已完成、提交预览。**「已读」与「提交预览」两列没有
 * 数据源**，所以不渲染（`docs/DO-NOT-BUILD.md`：没有数据源就不要渲染，更不要编一个）：
 *
 *   「已读」      全库没有任何「家长读过某条任务」的落点 —— 没有 `read_at`，
 *                 也没有可达的通知已读表。这一列在原型里是三个写死的字。
 *   「提交预览」  契约的 `ParentTaskSubmissionBoardRow` 只有五个字段，**不含家长正文**
 *                 （理由是对的：列表端点没有理由把全班正文一次性发出去），而教师端
 *                 **没有配套的单笔详情端点**。已登记为 GAPS **G70**。
 *
 * 于是表格剩三列：幼儿、状态、提交时间。三列比四列窄，两列假数据比三列真数据糟。
 *
 * ── 状态是三档不是两档 ─────────────────────────────────────────────────────
 *
 * `under_content_check` 为真时那一笔正在微信内容检查里，既不是已完成也不是家长没交。
 * 折算在 service 里做一次（`stateLabel`／`stateTone`），页面不判枚举。
 *
 * ── 顶上的三个数字 ─────────────────────────────────────────────────────────
 *
 * 「班级人数」是**目前**班上在园幼儿数（与看板行数同一个集合），不是发布当时的名册
 * 快照。原型的「已读」那一格换成「审核中」—— 那是看板真的回的一档。
 *
 * ── 「结束任务」在这一页 ───────────────────────────────────────────────────
 *
 * `s2→s3` 是**单向的终局**，契约里没有 `s3→s2`（F16）。所以按下去之前弹一次确认，
 * 与在园时光发布前那次确认同一条理由：不可逆的动作值得一次重看。
 * 关闭后尚未提交的那几笔立即退出家长端待处理提醒，且**不冒充完成**（F11／Q60-l）。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

Page({
  data: {
    task: null,
    metrics: [],
    rows: [],
    rate: 0,
    loading: true,
    error: '',
    closing: false,
  },

  onLoad(query) {
    this.taskId = query && query.id;
    if (!this.taskId) {
      this.setData({ loading: false, error: '缺少任务编号，请从列表进入' });
      return;
    }
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      // 两条端点并发：详情给标题与状态，看板给名册。互不依赖，没有理由排队。
      const [task, board] = await Promise.all([
        co.getTask(this.taskId),
        co.submissionBoard(this.taskId),
      ]);
      this.setData({
        task,
        rows: board.rows,
        rate: board.summary.percent,
        metrics: [
          { value: String(board.summary.total), label: '班级人数' },
          { value: String(board.summary.done), label: '已完成' },
          { value: String(board.summary.underCheck), label: '审核中' },
        ],
        loading: false,
      });
      wx.setNavigationBarTitle({ title: task.title });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || '任务加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  async onClose() {
    if (this.data.closing || !this.data.task.can.close) return;
    const confirmed = await this.confirmClose();
    if (!confirmed) return;

    this.setData({ closing: true });
    wx.showLoading({ title: '正在结束', mask: true });
    try {
      const task = await co.closeTask(this.taskId);
      wx.hideLoading();
      this.setData({ task, closing: false });
      wx.showToast({ title: '已结束', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ closing: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '结束失败，请稍后重试', icon: 'none' });
    }
  },

  /** 确认弹窗。resolve(true) 才继续。 */
  confirmClose() {
    const undone = this.data.rows.filter((r) => !r.done).length;
    return new Promise((resolve) => {
      wx.showModal({
        title: '结束这个任务？',
        content: `还有 ${undone} 名幼儿未完成。\n结束后家长不能再提交，这个任务也不能重新开启。`,
        confirmText: '结束任务',
        cancelText: '再看看',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
  },
});
