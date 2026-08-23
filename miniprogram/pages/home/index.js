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
const guard = require('../../utils/guard');
const time = require('../../utils/time');
const identity = require('../../services/identity');
const { present } = require('../../utils/present');

// Flowchart 01's 常用入口. `module` is checked against the role allowlist before
// navigation; `page` is null until that screen exists in this slice.
// `needsTerm` marks the write entries the holiday read-only state disables.
const QUICK_ENTRIES = [
  { key: 'training', label: '教研培训', module: 'teaching-research', page: null, needsTerm: false },
  { key: 'moment', label: '在园时光', module: 'co-education', page: null, needsTerm: true },
  { key: 'month-eval', label: '月度评价', module: 'co-education', page: null, needsTerm: true },
  { key: 'resource', label: '课程资源', module: 'resource-library', page: null, needsTerm: false },
];

Page({
  data: {
    ready: false,
    loading: true,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    teacherName: '',
    className: '',
    termName: '',
    noTerm: false,
    termNotice: '',
    canWrite: false,

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

  /**
   * The term can roll over while the app sits in the background: the holiday
   * ends and the same page's write entries must come back WITHOUT a re-login
   * (ticket 06). Re-read the context on every show; cheap, and the answer is
   * always current.
   */
  async onShow() {
    if (!this.data.ready || !identity.isLoggedIn()) return;
    try {
      await identity.refreshContext();
      this.hydrateFromSession();
    } catch (err) {
      if (identity.handleAuthFailure(err)) return;
      // A failed refresh keeps the last known state; the next show retries.
    }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  /**
   * Fill the header from the cached session context, through the service.
   *
   * §6.4: `scope` is for display only. Showing the class name is exactly the
   * sanctioned use; writing it back into a request body is not. The term state
   * is first-class (ticket 06): the page renders `termName` / `termNotice` /
   * `canWrite` and never inspects the term enum itself.
   */
  hydrateFromSession() {
    const home = identity.homeIdentity();
    const term = identity.termState();
    this.setData({
      teacherName: home.teacherName,
      className: home.className,
      termName: term.termName,
      noTerm: home.noTerm,
      termNotice: term.notice,
      canWrite: term.canWrite,
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
    if (identity.handleAuthFailure(err)) return;
    const failure = present(err);
    this.setData({
      loading: false,
      errorText: failure.message,
      errorRequestId: failure.requestId,
      errorCanRetry: failure.canRetry,
    });
  },

  onRetryLoad() {
    this.load();
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
    // Ticket 06: a write entry during the holiday is disabled WITH its reason
    // on the spot — never a tap that silently does nothing.
    if (entry.needsTerm && !this.data.canWrite) {
      wx.showToast({ title: '假期中暂不可发布，新学期开始后恢复', icon: 'none' });
      return;
    }
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
