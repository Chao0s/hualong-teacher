/**
 * Home — APP-STRUCTURE.md flowchart 01, screen id `Home`.
 *
 * Four regions, per the flowchart: 待办事项 / 资源中心通知 / 常用入口 /
 * 推荐课程案例.
 *
 * This page is the layering template the remaining 38 screens copy (ticket 08).
 * It calls services, calls setData, and answers taps. It holds no endpoint
 * path, no enum table, no time format and no error branch — those live in
 * services/home.js, services/notice.js and utils/present.js.
 */

const guard = require('../../utils/guard');
const identity = require('../../services/identity');
const home = require('../../services/home');
const { reportFailure } = require('../../utils/present');

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
    todoCount: 0,
    notices: [],
    cases: [],
    // Write entries start off and are turned on by the term state, never the
    // other way round.
    quickEntries: home.quickEntries(false),
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
   * Fill the header and the entry states from the cached session context.
   *
   * §6.4: `scope` is for display only. Showing the class name is exactly the
   * sanctioned use; writing it back into a request body is not. The term state
   * is first-class (ticket 06): this page renders what `termState()` returns and
   * never inspects the term enum itself.
   */
  hydrateFromSession() {
    const who = identity.homeIdentity();
    const term = identity.termState();
    this.setData({
      teacherName: who.teacherName,
      className: who.className,
      termName: term.termName,
      noTerm: who.noTerm,
      termNotice: term.notice,
      canWrite: term.canWrite,
      quickEntries: home.quickEntries(term.canWrite),
    });
  },

  async load() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const view = await home.load();
      this.setData({ ...view, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
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

  onTodoTap() {
    home.openTodo();
  },

  onCaseTap(e) {
    home.openCase(e.currentTarget.dataset.id);
  },

  onCaseMore() {
    home.openCaseList();
  },

  onQuickTap(e) {
    home.openQuickEntry(e.currentTarget.dataset.key, this.data.canWrite);
  },
});
