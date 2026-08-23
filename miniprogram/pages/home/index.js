/**
 * Home — APP-STRUCTURE.md flowchart 01, screen id `Home`.
 *
 * Four regions, per the flowchart: 待办事项 / 资源中心通知 / 常用入口 /
 * 推荐课程案例. The todo region is role-scoped — a teacher sees teacher todos,
 * and an admin acting through this client sees the audit queue as well.
 *
 * This slice renders the shell and the notice + todo reads. The quick entries
 * point at modules that do not have pages yet; those taps are gated by
 * `guard.navigateTo` and report honestly instead of dead-ending.
 */

const api = require('../../utils/request');
const session = require('../../utils/session');
const guard = require('../../utils/guard');
const time = require('../../utils/time');
const { ApiError } = require('../../utils/errors');

// Flowchart 01's 常用入口. `module` is checked against the role allowlist before
// navigation; `page` is null until that screen exists in this slice.
const QUICK_ENTRIES = [
  { key: 'training', label: '教研培训', module: 'teaching-research', page: null },
  { key: 'moment', label: '在园时光', module: 'co-education', page: null },
  { key: 'month-eval', label: '月度评价', module: 'co-education', page: null },
  { key: 'resource', label: '课程资源', module: 'resource-library', page: null },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',

    teacherName: '',
    className: '',
    termName: '',
    noTerm: false,

    todos: [],
    notices: [],
    quickEntries: QUICK_ENTRIES,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.hydrateFromSession();
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  /**
   * Fill the header from the cached session context.
   *
   * §6.4: `scope` is for display only. Showing the class name is exactly the
   * sanctioned use; writing it back into a request body is not.
   */
  hydrateFromSession() {
    const subject = session.getSubject() || {};
    const scope = session.getScope() || {};
    const term = session.getCurrentTerm();
    this.setData({
      teacherName: subject.teacher_name || '',
      className: scope.class_name || '',
      termName: term ? term.term_name : '',
      noTerm: !term,
    });
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '' });
    try {
      // Two independent reads. Settled rather than awaited in sequence so one
      // slow list does not hold the other back.
      const [todos, notices] = await Promise.all([
        this.loadTodos(),
        this.loadNotices(),
      ]);
      this.setData({ todos, notices, loading: false });
    } catch (err) {
      this.reportError(err);
    }
  },

  /**
   * 待办事项. Roster-shaped: bounded by the teacher's own workload and meant to
   * be read whole, so it does not paginate (§3.5).
   */
  async loadTodos() {
    const rows = await api.getRoster('/home/todos');
    return rows.map((row) => ({
      ...row,
      due_label: row.due_at ? time.formatShort(row.due_at) : '',
      // §1.1: tolerate unknown enum codes. An unrecognised kind degrades to a
      // neutral pill rather than throwing.
      pill_class: TODO_PILL[row.todo_kind] || 'hl-pill--unknown',
      kind_label: TODO_LABEL[row.todo_kind] || '待办',
    }));
  },

  /** 资源中心通知 — a time stream, so cursor-paginated (§3.1). First page only. */
  async loadNotices() {
    const { items } = await api.getPage('/notices', { limit: 5 });
    return items.map((n) => ({
      ...n,
      published_label: time.formatShort(n.published_at),
    }));
  },

  reportError(err) {
    if (err instanceof ApiError && err.isAuthFailure) {
      session.clear();
      guard.redirectToLogin();
      return;
    }
    this.setData({
      loading: false,
      errorText: err instanceof ApiError ? err.userMessage : '加载失败，请下拉重试',
      errorRequestId: err instanceof ApiError ? (err.requestId || '') : '',
    });
  },

  onNoticeTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/notice/detail?notice_id=${id}` });
  },

  onNoticeMore() {
    wx.navigateTo({ url: '/pages/notice/list' });
  },

  onQuickTap(e) {
    const { key } = e.currentTarget.dataset;
    const entry = QUICK_ENTRIES.find((q) => q.key === key);
    if (!entry) return;
    if (!entry.page) {
      wx.showToast({ title: '该模块尚未上线', icon: 'none' });
      return;
    }
    guard.navigateTo(entry.page, entry.module);
  },
});

const TODO_PILL = {
  upload: 'hl-pill--info',
  task: 'hl-pill--pending',
  audit: 'hl-pill--danger',
  evaluation: 'hl-pill--ok',
};

const TODO_LABEL = {
  upload: '待上传',
  task: '待完成',
  audit: '待审核',
  evaluation: '待填写',
};
