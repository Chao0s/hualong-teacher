/**
 * 研修详情 —— 数据来自 `GET /trainings/{id}`、`/feedback`，写动作是报名与回馈。
 *
 * **打开这一页会在服务端记一笔 viewed**（规则 21，重复打开重复计数）。
 *
 * ── 四块的显隐都读服务端的值，不读 URL 参数 ───────────────────────────────
 *
 * 原型靠 `?type=history` 决定显示什么，那是查询字符串说了算 —— 改一下地址栏就能
 * 让页面显示不该显示的块。现在四块各读各的依据：
 *
 *   研修材料   `files` 非空。撤回的活动服务端不给材料，所以这一块自然不出现
 *   线上会议   `hasMeeting`（`meeting_url` 与 `meeting_link_title` 同空同非空）
 *   报名入口   `can.register || can.cancel` —— 状态机在 service 里，页面不判
 *   研修反馈   活动已过（`phase === 'history'`）且**本人已完成**（`myStatus === 's3'`）
 *
 * ── 会议链接只复制，不跳转 ─────────────────────────────────────────────────
 *
 * `meeting_url` 只供复制到浏览器或会议 App（F9）。**不做 `web-view`，也不做点击
 * 直接跳转** —— 那等于内嵌外站。
 *
 * ── 撤回的活动只是壳 ───────────────────────────────────────────────────────
 *
 * `s5` 打得开，但材料、会议入口、公开回馈服务端一律不给。页面据此显示一句说明，
 * **不渲染三个空区块**。
 *
 * ── 回馈提交之后查不到自己那一份 ───────────────────────────────────────────
 *
 * 作者不可撤回、不可查询 pending／rejected、不可查看驳回理由（F9／Q58-ap1）。
 * 所以提交成功只显示「已提交，审核通过后公开」，**不显示一个假的「审核中」状态** ——
 * 那个状态客户端根本读不到。
 */

const training = require('../../services/training');
const guard = require('../../utils/guard');

const FEEDBACK_LIMIT = 20;

Page({
  data: {
    detail: null,
    feedbacks: [],
    feedbackCursor: null,

    draft: '',
    submitted: false,
    acting: false,

    loading: true,
    error: '',
  },

  onLoad(query) {
    this.trainingId = Number(query.id) || 0;
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const detail = await training.getTraining(this.trainingId);
      this.setData({ detail, loading: false });
      wx.setNavigationBarTitle({ title: detail.title });

      // 撤回的活动没有公开回馈，不必再打一次。
      if (!detail.withdrawn) await this.loadFeedback(true);
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        detail: null,
        error: err.userMessage || '研修详情加载失败，请稍后重试',
      });
    }
  },

  async loadFeedback(first) {
    try {
      const page = await training.listFeedback(this.trainingId, {
        cursor: first ? undefined : this.data.feedbackCursor,
        limit: FEEDBACK_LIMIT,
      });
      this.setData({
        feedbacks: first ? page.items : this.data.feedbacks.concat(page.items),
        feedbackCursor: page.nextCursor,
      });
    } catch (err) {
      // 回馈取不到不该拖垮整页 —— 详情本身已经显示出来了。
      wx.showToast({ title: err.userMessage || '反馈加载失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  /** 游标为空是结束的唯一信号（§3.1）。 */
  onMoreFeedback() {
    if (!this.data.feedbackCursor) {
      wx.showToast({ title: '没有更多反馈了', icon: 'none' });
      return;
    }
    this.loadFeedback(false);
  },

  /* ── 报名与取消 ────────────────────────────────────────────────────────── */

  /**
   * 一个按钮两个动作，按 `can` 决定发哪一条。
   *
   * 取消要确认：取消之后开始前还能再报名，但教师不一定知道这一点，
   * 弹一次也顺便说清楚。报名不确认 —— 它是可逆的。
   */
  async onSignup() {
    const d = this.data.detail;
    if (!d || this.data.acting) return;

    if (d.can.cancel) {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '取消报名',
          content: '取消后名额会让给别人。开始前你还可以再报名。',
          confirmText: '取消报名',
          cancelText: '再想想',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        });
      });
      if (!ok) return;
    } else if (!d.can.register) {
      return;
    }

    const action = d.can.cancel ? 'cancel' : 'register';
    this.setData({ acting: true });
    try {
      await training[action](this.trainingId);
      // 报名改的是 my_participation_status，整条重取比本地推状态可靠。
      const detail = await training.getTraining(this.trainingId);
      this.setData({ detail, acting: false });
      wx.showToast({ title: action === 'cancel' ? '已取消报名' : '已报名', icon: 'none' });
    } catch (err) {
      this.setData({ acting: false });
      wx.showModal({
        title: action === 'cancel' ? '取消失败' : '报名失败',
        content: training.actionFailureText(err, action),
        showCancel: false,
      });
      // 多半是状态在别处变了，重取一次让按钮跟上。
      this.load();
    }
  },

  /* ── 会议链接 ──────────────────────────────────────────────────────────── */

  onCopyMeeting() {
    const url = this.data.detail && this.data.detail.meetingUrl;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '链接已复制', icon: 'none' }),
    });
  },

  /* ── 回馈 ──────────────────────────────────────────────────────────────── */

  onDraftInput(e) {
    this.setData({ draft: e.detail.value });
  },

  /**
   * 提交回馈。**一人一场一份，提交即冻结**，所以先确认。
   *
   * 提交成功后不显示「审核中」—— 那个状态客户端读不到（见头注）。
   */
  async onSubmitFeedback() {
    if (this.data.submitted || this.data.acting) return;
    const why = training.whyCannotSubmitFeedback(this.data.draft);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }

    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '提交研修反馈',
        content: '提交后不能修改也不能撤回，审核通过后会以真名公开。确定提交吗？',
        confirmText: '提交',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!ok) return;

    this.setData({ acting: true });
    try {
      await training.submitFeedback(this.trainingId, this.data.draft);
      this.setData({ acting: false, submitted: true });
      wx.showToast({ title: '已提交，审核通过后公开', icon: 'none' });
    } catch (err) {
      this.setData({ acting: false });
      wx.showModal({
        title: '提交失败',
        content: err.userMessage || '请稍后重试',
        showCancel: false,
      });
    }
  },

  /** 材料预览与下载：`POST /media/files` 那一族在本环境未实作，照实说明。 */
  onFileTap(e) {
    wx.showToast({
      title: `${e.currentTarget.dataset.name}（本环境不接对象存储）`,
      icon: 'none',
    });
  },
});
