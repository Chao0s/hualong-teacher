/**
 * 首页 —— 原型 screens/home.html 的小程序版本。
 *
 * 网页版把文字写死在 HTML 里；小程序的 wxml 只画结构，文字要从 data 传过去。
 * 所以原型里的四块内容（头图、近期任务、常用入口、推荐课程案例）在这里变成四份数据。
 * 底部导航搬到 hl-tabbar 组件，5 个页面共用。
 *
 * ── 「待处理 N」是真的数出来的 ─────────────────────────────────────────────
 *
 * `01 home-spec.md` 的 `pending_task_count_rule` 要的是
 * `COUNT db_task_assign WHERE teacher_id=$ctx AND assign_status IN(a1,a2)`。
 * 本轮 `GET /tasks` 补上之后这个数有了来源：`services/task.js` 的 `countPending()`
 * **翻完全部游标再数**。契约不回 total（DO-NOT-BUILD 11），所以只有翻完与编一个
 * 两条路，这里走前者。
 *
 * **数不出来就不写数**：取数失败时徽标退回「待处理」三个字，不写 0 ——
 * 「零件待办」与「没问到」是两件事，而写 0 的那一版恰好是教师最容易信的一版。
 * 这三格的另外两格没有变：「上传资源」的「提交审核」是入口说明、不是计数；
 * 「质量评估」的 `3/120` 读的是本机 Storage 里已打分的条目数。
 */

const task = require('../../services/task');
const guard = require('../../utils/guard');

const ASSESSMENT_STORAGE_KEY = 'hualong_assessment_v1';
const ASSESSMENT_TOTAL = 120;

/** 数不出来时徽标上的那句话。**不含数字。** */
const TASK_BADGE_UNKNOWN = '待处理';

// 已转成小程序的页面写路径，没转的写 null，点了弹提示
const TARGETS = {
  upload: '/pages/upload-resource/index',
  task: '/pages/teacher-tasks/index',
  assess: '/pages/assessment-tool/index',
  training: '/pages/training-list/index',
  moments: '/pages/home-school-moments/index',
  monthly: '/pages/teacher-monthly-form/index',
  resource: '/pages/resource-center/index',
};

Page({
  data: {
    banner: {
      title: '教师工作台',
      sub: '上传资源、处理待办任务',
    },

    todos: [
      { key: 'upload', glyph: '传', title: '上传资源', badge: '提交审核', tone: 'accent' },
      // 初值不含数字：这一格在 refreshPendingTaskBadge() 问到之前没有答案。
      { key: 'task', glyph: '办', title: '待办任务', badge: TASK_BADGE_UNKNOWN, tone: 'warn' },
      { key: 'assess', glyph: '评', title: '质量评估', badge: '3/120', tone: 'info' },
    ],

    quickEntries: [
      { key: 'training', label: '教研培训' },
      { key: 'moments', label: '在园时光' },
      { key: 'monthly', label: '月度评价' },
      { key: 'resource', label: '课程资源' },
    ],

    cases: [
      { id: 1, glyph: '社', name: '祠堂里的故事', tag: '社会 · 住', tone: 'accent' },
      { id: 2, glyph: '健', name: '龙舟竞渡', tag: '健康 · 行', tone: 'green' },
      { id: 3, glyph: '艺', name: '醒狮从哪里来', tag: '语言 · 艺', tone: 'amber' },
    ],
  },

  onShow() {
    this.refreshAssessmentBadge();
    this.refreshPendingTaskBadge();
  },

  /**
   * 待办任务徽标 —— `assign_status` 在 `a1`／`a2` 的行数。
   *
   * 失败不弹提示：首页一进来就弹一个红框，代价比一个不带数字的徽标大得多。
   */
  async refreshPendingTaskBadge() {
    try {
      await guard.requireSession();
      const n = await task.countPending();
      this.setData({ 'todos[1].badge': `${TASK_BADGE_UNKNOWN} ${n}` });
    } catch (err) {
      // 先把徽标退回不带数字的那一版，再清死会话：顺序反过来的话，
      // 上一次成功取到的数会留在屏幕上，而它已经不作数了。
      this.setData({ 'todos[1].badge': TASK_BADGE_UNKNOWN });
      guard.endSessionOnAuthFailure(err);
    }
  },

  /**
   * 质量评估徽标 —— 原型页尾那段脚本的等价实现。
   * 网页版读 localStorage，小程序读 Storage，口径一样：算已打分的条目数。
   */
  refreshAssessmentBadge() {
    let done = 0;
    try {
      const scores = wx.getStorageSync(ASSESSMENT_STORAGE_KEY) || {};
      done = Object.keys(scores).filter((k) => scores[k] >= 1).length;
    } catch (e) {
      /* 读不到就按 0 算 */
    }
    this.setData({ 'todos[2].badge': `${done}/${ASSESSMENT_TOTAL}` });
  },

  onTodoTap(e) {
    this.go(e.currentTarget.dataset.key, this.data.todos, 'key', 'title');
  },

  onQuickTap(e) {
    this.go(e.currentTarget.dataset.key, this.data.quickEntries, 'key', 'label');
  },

  onCaseTap() {
    wx.navigateTo({ url: '/pages/case-detail/index' });
  },

  onCaseMore() {
    wx.navigateTo({ url: '/pages/case-library/index' });
  },

  go(key, list, idField, nameField) {
    const url = TARGETS[key];
    if (url) {
      wx.navigateTo({ url });
      return;
    }
    const hit = list.find((item) => item[idField] === key);
    wx.showToast({ title: `${hit ? hit[nameField] : '该入口'}（预览工程未接入）`, icon: 'none' });
  },
});
