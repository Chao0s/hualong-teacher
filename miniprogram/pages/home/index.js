/**
 * 首页 —— 原型 screens/home.html 的小程序版本。
 *
 * 网页版把文字写死在 HTML 里；小程序的 wxml 只画结构，文字要从 data 传过去。
 * 所以原型里的四块内容（头图、近期任务、常用入口、推荐课程案例）在这里变成四份数据。
 * 底部导航搬到 hl-tabbar 组件，5 个页面共用。
 */

const ASSESSMENT_STORAGE_KEY = 'hualong_assessment_v1';
const ASSESSMENT_TOTAL = 120;

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
      { key: 'task', glyph: '办', title: '待办任务', badge: '待处理 0', tone: 'warn' },
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
