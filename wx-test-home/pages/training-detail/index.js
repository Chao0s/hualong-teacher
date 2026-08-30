/**
 * 研修详情 —— 原型 screens/training-detail.html 的小程序版本。
 *
 * 三块的显隐规则照抄原型：
 *   isHistory = ?type=history 或 状态是「已完成」
 *   报名入口   非历史场次才显示
 *   研修反馈   历史场次、且这条数据带 completedParticipant 才显示
 *   线上会议   这条数据带 meeting 才显示
 *
 * 报名和反馈都只改本页状态，不落库，和原型一致。
 */

const TRAININGS = {
  'game-course': {
    status: '即将开始',
    title: '幼儿园课程游戏化的理论与实践',
    meta: '6月28日 14:00 · 多功能厅 · 主讲：陈园长',
    summary: '围绕游戏化课程设计、材料投放和教师观察支持展开。',
    meeting: { title: '腾讯会议：课程游戏化专题研修', url: 'https://meeting.tencent.com/dm/example' },
    materials: ['课程游戏化培训讲义.pdf', '游戏材料投放观察表.xlsx', '小组研讨记录模板.docx', '园本案例：建构区里的桥.pdf'],
  },
  observation: {
    status: '已完成',
    title: '幼儿行为观察与记录方法',
    meta: '6月12日 15:00 · 会议室二 · 主讲：李老师',
    summary: '练习轶事记录、时间取样和事件取样，并形成班级观察记录样例。',
    materials: ['行为观察方法讲义.pdf', '轶事记录示例.docx', '时间取样记录表.xlsx', '观察记录评价标准.pdf', '班级观察案例包.zip'],
    completedParticipant: true,
  },
  'home-connect': {
    status: '已完成',
    title: '家园沟通技巧与案例分享',
    meta: '5月30日 10:00 · 线上会议 · 主讲：王主任',
    summary: '聚焦家长沟通边界、正向反馈和争议场景的回应策略。',
    materials: ['家园沟通案例手册.pdf', '沟通记录表.docx', '线上会议回放链接.txt'],
    completedParticipant: true,
  },
  lingnan: {
    status: '报名中',
    title: '岭南文化融入幼儿园课程专题研修',
    meta: '7月8日 09:30 · 区教师发展中心 · 主讲：外聘专家',
    summary: '从地方文化资源采集、活动转化和课程评价三个层面展开。',
    materials: ['研修通知.pdf', '岭南文化资源清单.xlsx', '外出培训报名表.docx', '课程转化案例选读.pdf'],
  },
};

const FEEDBACKS = [
  { teacher: '黄老师', time: '刚刚', text: '材料中的观察表可以直接用于区域活动，建议后续增加小班样例。' },
  { teacher: '林老师', time: '10 分钟前', text: '研修后我准备把留耕堂案例放进本月社会领域主题。' },
  { teacher: '陈老师', time: '昨天', text: '反馈表已经提交，材料下载正常。' },
];

Page({
  data: {
    training: TRAININGS['game-course'],
    isHistory: false,
    feedbacks: FEEDBACKS,
    registered: false,
    draft: '',
    submitted: false,
  },

  onLoad(options) {
    const id = options.id && TRAININGS[options.id] ? options.id : 'game-course';
    const training = TRAININGS[id];
    this.setData({
      training,
      isHistory: options.type === 'history' || training.status === '已完成',
    });
  },

  onSignup() {
    const registered = !this.data.registered;
    this.setData({ registered });
    wx.showToast({ title: registered ? '报名成功' : '已取消报名', icon: 'none' });
  },

  onCopyMeeting() {
    wx.setClipboardData({
      data: this.data.training.meeting.url,
      success: () => wx.showToast({ title: '会议链接已复制', icon: 'none' }),
    });
  },

  onDraftInput(e) {
    this.setData({ draft: e.detail.value });
  },

  onSubmitFeedback() {
    if (this.data.submitted || !this.data.draft.trim()) return;
    this.setData({ submitted: true });
    wx.showToast({ title: '反馈已提交，内容不可修改；审核通过后公开', icon: 'none' });
  },

  onMoreFeedback() {
    wx.showToast({ title: '没有更多已公开反馈', icon: 'none' });
  },

  onToast(e) {
    wx.showToast({ title: e.currentTarget.dataset.action, icon: 'none' });
  },
});
