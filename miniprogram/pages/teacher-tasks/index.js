/**
 * 待办任务 —— 数据来自 `GET /tasks`，一行是派到**本人**头上的一条任务。
 *
 * ── 排序是契约定死的，客户端不选 ───────────────────────────────────────────
 *
 * 服务端按 `due_at ASC, task_id ASC` 排（G63 的教师端那一半，本轮拍板）：
 * 最早要交的排最前面。排序键就是游标结构，客户端不给排序参数（§3.2）。
 *
 * ── 卡片上没有按钮 ─────────────────────────────────────────────────────────
 *
 * 徽章取**自己那一行的 `assign_status`**（F28），不是 `task_status` ——
 * 列表端点根本不回后者。接受与完成两个动作要判 `task_status`，所以它们只在
 * `teacher-task-detail`（任务详情，待办任务那条线）上，不在这张卡片上。
 *
 * ── 原型的三块删掉了，不是漏了 ─────────────────────────────────────────────
 *
 *   「当前任务 2 项」「历史任务 1 项」  分组按 `task_status` 分，那一列列表端点
 *                                      不回（F28）；「N 项」还要一个 total，
 *                                      而游标分页没有 total（DO-NOT-BUILD 11）
 *   卡片上的三行摘要                    `task_intro` 是详情端点的字段，列表不回
 *   脚上的三枚标签                      「背景信息／分工要求／时间节点」在任何一张
 *                                      表里都没有列，是原型的 demo 值
 */

const task = require('../../services/task');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

Page({
  data: {
    tasks: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await task.listTasks({ limit: PAGE_LIMIT });
      this.setData({
        tasks: page.items,
        nextCursor: page.nextCursor,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        tasks: [],
        error: err.userMessage || '待办任务加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（§3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await task.listTasks({
        cursor: this.data.nextCursor, limit: PAGE_LIMIT,
      });
      this.setData({
        tasks: this.data.tasks.concat(page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (err) {
      this.setData({ loadingMore: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '加载更多失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  onCardTap(e) {
    const id = Number(e.currentTarget.dataset.id);
    wx.navigateTo({ url: `/pages/teacher-task-detail/index?id=${id}` });
  },
});
