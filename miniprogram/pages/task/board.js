/**
 * 任务进度看板 — APP-STRUCTURE.md screen id `TaskBoard`.
 *
 * Read-only (ticket 10). The teacher's own tasks and where each one stands, so
 * "what do I do first" is answerable without opening anything.
 *
 * Thin by the ticket-08 template, and the first page to use the filter channel
 * added in ticket 09: `filters` goes into every fetchPage call, and changing it
 * reloads from the top because §3.3 binds a cursor to the filter set it was
 * issued under.
 */

const guard = require('../../utils/guard');
const task = require('../../services/task');
const { createListMethods } = require('../../utils/list-page');

// 当前 / 历史 mirrors the prototype's two groups. 全部 is the unfiltered read.
const SCOPES = [
  { key: 'current', label: '当前任务' },
  { key: 'history', label: '历史任务' },
  { key: '', label: '全部' },
];

Page({
  data: {
    ready: false,
    scopes: SCOPES,
    activeScope: 'current',
    filters: { scope: 'current' },

    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.loadFirst();
  },

  /**
   * 从详情或提交页返回时重读（票据 11）。onLoad 先于 onShow，所以第一次 onShow
   * 只做记号，不重复发一次请求。
   */
  onShow() {
    if (!this.entered) {
      this.entered = true;
      return;
    }
    return this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  ...createListMethods({ fetchPage: task.listPage }),

  /**
   * §3.3: the old cursor belongs to the old filter set. Setting `filters` and
   * reloading from the top is the whole mechanism — loadFirst drops the cursor
   * itself, so there is nothing to remember here.
   */
  onScopeTap(e) {
    const { scope } = e.currentTarget.dataset;
    if (scope === this.data.activeScope) return;
    this.setData({ activeScope: scope, filters: { scope } });
    this.loadFirst();
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/task/detail?task_id=${id}` });
  },
});
