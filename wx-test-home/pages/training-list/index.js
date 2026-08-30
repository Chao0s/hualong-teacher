/**
 * 教研培训 —— 原型 screens/training-list.html 的小程序版本。
 *
 * 「更多」在原型里链回本页带查询参数（?section=latest&view=all），
 * 没有独立页面，所以这里保持弹提示。
 */

const PROFILE_ROUTES = {
  user: '/pages/teacher-profile/index',
  book: '/pages/my-training/index',
};

Page({
  data: {
    profiles: [
      { key: 'user', title: '个人档案', desc: '教龄、学历、证书与专业发展记录' },
      { key: 'book', title: '我的研修', desc: '参与记录、提交材料与研修成果' },
    ],

    groups: [
      {
        title: '最新研修',
        items: [
          {
            id: 'game-course', type: 'latest',
            title: '幼儿园课程游戏化的理论与实践', badge: '即将开始',
            meta: '6月28日 14:00 · 多功能厅 · 主讲：陈园长',
            summary: '围绕游戏化课程设计、材料投放和教师观察支持展开。',
            pills: ['研修材料 4', '开放报名'],
          },
          {
            id: 'lingnan', type: 'latest',
            title: '岭南文化融入幼儿园课程专题研修', badge: '报名中',
            meta: '7月8日 09:30 · 区教师发展中心 · 主讲：外聘专家',
            summary: '从地方文化资源采集、活动转化和课程评价三个层面展开。',
            pills: ['研修材料 4', '开放报名'],
          },
        ],
      },
      {
        title: '历史研修',
        items: [
          {
            id: 'observation', type: 'history',
            title: '幼儿行为观察与记录方法', badge: '已完成',
            meta: '6月12日 15:00 · 会议室二 · 主讲：李老师',
            summary: '练习轶事记录、时间取样和事件取样，并形成班级观察记录样例。',
            pills: ['研修材料 5', '反馈 24'],
          },
          {
            id: 'home-connect', type: 'history',
            title: '家园沟通技巧与案例分享', badge: '已完成',
            meta: '5月30日 10:00 · 线上会议 · 主讲：王主任',
            summary: '聚焦家长沟通边界、正向反馈和争议场景的回应策略。',
            pills: ['研修材料 3', '反馈 21'],
          },
        ],
      },
    ],
  },

  onProfileTap(e) {
    wx.navigateTo({ url: PROFILE_ROUTES[e.currentTarget.dataset.key] });
  },

  onTrainingTap(e) {
    const { id, type } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/training-detail/index?id=${id}&type=${type}` });
  },

  onNotYet(e) {
    wx.showToast({ title: `${e.currentTarget.dataset.name}（预览工程未接入）`, icon: 'none' });
  },
});
