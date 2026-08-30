/** 我的研修 —— 原型 screens/my-training.html 的小程序版本。 */

Page({
  data: {
    records: [
      {
        id: 'lingnan', type: 'latest', state: 'doing', stateText: '报名中',
        title: '岭南文化融入幼儿园课程专题研修',
        meta: '2026.07.08 09:30 · 区教师发展中心',
        summary: '从地方文化资源采集、活动转化和课程评价三个层面展开。',
        pills: ['研修材料 4', '已报名'],
      },
      {
        id: 'game-course', type: 'latest', state: 'wait', stateText: '即将开始',
        title: '幼儿园课程游戏化的理论与实践',
        meta: '2026.06.28 14:00 · 多功能厅',
        summary: '围绕游戏化课程设计、材料投放和教师观察支持展开。',
        pills: ['研修材料 4', '已报名'],
      },
      {
        id: 'observation', type: 'history', state: 'done', stateText: '已完成',
        title: '幼儿行为观察与记录方法',
        meta: '2026.06.12 15:00 · 会议室二',
        summary: '练习轶事记录、时间取样和事件取样，并形成班级观察记录样例。',
        pills: ['研修材料 5', '反馈已提交'],
      },
      {
        id: 'home-connect', type: 'history', state: 'done', stateText: '已完成',
        title: '家园沟通技巧与案例分享',
        meta: '2026.05.30 10:00 · 线上会议',
        summary: '聚焦家长沟通边界、正向反馈和争议场景的回应策略。',
        pills: ['研修材料 3', '反馈已提交'],
      },
      {
        // 原型里这一条是不可点的 <div>，没有 id
        id: '', state: 'plain', stateText: '活动已撤回',
        title: '区域游戏材料投放专题研修',
        meta: '2026.05.18 14:30',
        summary: '活动记录保留；材料、会议入口和公开反馈已关闭。',
      },
    ],
  },

  onCardTap(e) {
    const { id, type } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/training-detail/index?id=${id}&type=${type}` });
  },
});
