/**
 * 发布家长测评 —— 教师给全班开一次评价窗口（F26 解 G50 之后）。
 *
 *   `POST /home-school/parent-evaluations`   开窗，全班 fan-out
 *   `GET  /home-school/parent-evaluations`   底下的历史列表
 *
 * ── 一次开窗给全班每人建一行 ───────────────────────────────────────────────
 *
 * 对象集合由**服务端**按「发起当下本班全部在园幼儿」算，**客户端不发 child_id**。
 * 重复发起是安全的：唯一键加 `ON CONFLICT DO NOTHING`，缺行补上、已有行原样不动，
 * 已有行的提示语**不会被覆盖**（家长可能照着旧提示写了一半）。
 *
 * 开窗后转入的幼儿不补行，所以完成情况的分母是**那一期真实的行数**，
 * 不是查询当下的班级人数。
 *
 * ── 原型的表单缺三个 NOT NULL 列 ───────────────────────────────────────────
 *
 * 原型只有「评价类型」与「评价说明」两格，而 DDL 上 `evaluation_period`、
 * `evaluation_title`、`start_at` 都是 `NOT NULL` —— **那张表单在原型里根本提交不成功**，
 * 与上一轮亲子任务缺 `start_at` 是同一类。
 *
 * 三个都补上，但补法不同：
 *
 *   期间   月度默认园所本月，教师可选择其他月份；学期取会话的当前学期。
 *          它是不透明字符串，**不当日期解析**（§1.2）—— `2025-2026-2` 不是日期。
 *   标题   派生一个默认值，**给一格让教师改**。它要进家长端的列表，得看得懂。
 *   时间   **只挑日期，不挑钟点**。`start_at` 在库里是 `TIMESTAMP NOT NULL`，所以仍要存一个
 *          钟点 —— 但那个钟点对家长没有区别（8:00 还是 8:30 开窗，家长感觉不到），
 *          所以固定成开始 08:00、截止 21:00，与数据集里既有窗口的口径一致，不再问教师。
 *          组装仍走 §1.2 的计划时刻格式，必须带 `+08:00` 字面量。
 *
 * ── 历史列表 ───────────────────────────────────────────────────────────────
 *
 * 按 `evaluation_type + evaluation_period` 折成一组一行。点某一期带 `type` 与
 * `period` 两个参数进「测评进度」—— 不带的话那一页只能猜，会显示成另一期。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');
const auth = require('../../utils/auth');
const session = require('../../utils/session');
const time = require('../../utils/time');

/** 开窗默认开在今天，默认一周后截止。教师只挑日期。 */
const DEFAULT_DAYS = 7;

/**
 * 钟点固定，不给控件。
 *
 * `start_at`／`due_at` 在库里是 `TIMESTAMP`，必须有一个钟点；但教师挑 8:00 还是 8:30
 * 对家长没有任何区别 —— 家长看到的是「这个月要写评价，X 号截止」。
 * 取 08:00 开、21:00 截，与数据集里既有窗口的口径一致。
 */
const START_CLOCK = '08:00';
const DUE_CLOCK = '21:00';

Page({
  data: {
    types: ['月度评价', '学期评价'],
    typeIndex: 0,
    period: '',
    periodLabel: '',
    month: '',
    title: '',
    prompt: '请家长结合本月亲子任务、幼儿在家表现与照片记录，补充孩子的兴趣、生活习惯和成长变化。',

    startDate: '',
    dueDate: '',

    history: [],
    loading: true,
    failed: '',
    publishing: false,
  },

  onShow() {
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true, failed: '' });
    try {
      await guard.requireSession();
      const context = await auth.refreshContext();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(context.school_today || '')) {
        throw new Error('暂时无法取得园所日期，请重试');
      }
      this.schoolToday = context.school_today;
      if (!this.data.period) this.resetWindowFields();
      const history = await co.parentEvalPeriods({});
      this.setData({ history, loading: false });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        history: [],
        loading: false,
        failed: err.userMessage || err.message || '过往进度加载失败，请稍后重试',
      });
    }
  },

  /**
   * 按当前类型算期间、标题与默认时间。
   *
   * 期间是**不透明字符串**：月度用 `YYYY-MM`，学期用 `term_id`。两者都不当日期解析。
   * 假期里没有进行中的学期，此时学期评价开不了窗，照实说明。
   */
  resetWindowFields() {
    if (!this.schoolToday) return;
    const monthly = this.data.typeIndex === 0;
    const term = session.getCurrentTerm();

    const today = this.schoolToday;
    const month = this.data.month || today.slice(0, 7);
    const period = monthly ? month : (term ? term.term_id : '');
    const due = time.addLocalDays ? time.addLocalDays(today, DEFAULT_DAYS) : '';

    this.setData({
      period,
      month,
      periodLabel: co.evalPeriodLabelOf(period),
      title: this.titleEdited ? this.data.title : monthly
        ? `${co.evalPeriodLabelOf(period)}家长月度评价`
        : `${period} 学期末家长评价`,
      startDate: this.data.startDate || today,
      dueDate: this.data.dueDate || due || today,
    });
  },

  onTypeChange(e) {
    if (this.data.publishing) return;
    this.setData({ typeIndex: Number(e.detail.value) }, () => this.resetWindowFields());
  },

  onMonthChange(e) {
    if (this.data.publishing || this.data.typeIndex !== 0) return;
    const month = e.detail.value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return;
    this.setData({ month }, () => this.resetWindowFields());
  },

  onTitleInput(e) {
    this.titleEdited = true;
    this.setData({ title: e.detail.value });
  },

  onPromptInput(e) {
    this.setData({ prompt: e.detail.value });
  },

  onStartDate(e) { this.setData({ startDate: e.detail.value }); },
  onDueDate(e) { this.setData({ dueDate: e.detail.value }); },

  form() {
    return {
      type: this.data.typeIndex === 0 ? 't1' : 't2',
      period: this.data.period,
      title: this.data.title,
      prompt: this.data.prompt,
      // 偏移量在 service／utils 里定，页面不拼时间戳。
      // 钟点是常量，不是教师挑的 —— 见上面 START_CLOCK 的注解。
      startAt: co.taskWireTime(this.data.startDate, START_CLOCK),
      dueAt: co.taskWireTime(this.data.dueDate, DUE_CLOCK),
    };
  },

  /**
   * 开窗。**一次给全班每人建一行**，所以按下去之前说清会影响多少人。
   *
   * 重复发起不会覆盖已有行，但会给新转入的幼儿补上 —— 确认文案照实说这一点。
   */
  async onPublish() {
    if (this.data.publishing) return;
    const form = this.form();
    // 预检不是校验：服务端独立再验一次。这里只让教师在点下去之前知道缺什么。
    const why = co.whyCannotOpenWindow(form);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }

    this.setData({ publishing: true });
    try {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '发布家长评价',
          content: `将给本班每名在园幼儿各开一份「${form.title}」，家长立刻能看到。`
            + `\n评价期间：${co.evalPeriodLabelOf(form.period)}。`
            + '已经开过的不会被覆盖。',
          confirmText: '发布',
          success: (r) => resolve(r.confirm),
          fail: () => resolve(false),
        });
      });
      if (!ok) return;

      const n = await co.openParentEvaluationWindow(form);
      wx.showToast({ title: `已发布，共 ${n} 名幼儿`, icon: 'none' });
      await this.refresh();
    } catch (err) {
      wx.showModal({
        title: '发布失败',
        content: err.userMessage || '请稍后重试',
        showCancel: false,
      });
    } finally {
      this.setData({ publishing: false });
    }
  },

  /** 点某一期进测评进度，把期间带过去 —— 不带的话那一页只能猜。 */
  onHistoryTap(e) {
    const row = this.data.history[Number(e.currentTarget.dataset.index)];
    if (!row) return;
    wx.navigateTo({
      url: `/pages/parent-evaluation-detail/index?type=${row.type}&period=${row.period}`,
    });
  },
});
