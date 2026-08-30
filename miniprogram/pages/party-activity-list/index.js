/** 党建活动 · 全部活动 —— 原型 screens/party-activity-list.html 的小程序版本。 */

Page({
  data: {
    activities: [
      { id: 'theme-day', title: '“红色故事进课堂”主题党日', meta: ['06-20', '多功能室'] },
      { id: 'volunteer', title: '党员教师社区志愿服务', meta: ['06-14', '社区广场'] },
      { id: 'reading', title: '青年教师理论读书会', meta: ['06-07', '党建室'] },
      { id: 'visit', title: '红色教育基地参访', meta: ['05-29', '区党群中心'] },
      { id: 'class', title: '党员示范课观摩', meta: ['05-16', '中三班'] },
    ],
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/party-activity-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
