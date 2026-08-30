/** 党建学习 · 全部文件 —— 原型 screens/party-study-list.html 的小程序版本。 */

Page({
  data: {
    docs: [
      { id: 'work-points', title: '新时代幼儿园党建工作要点', meta: ['政策文件', '06-18', '办公室'] },
      { id: 'discipline', title: '师德师风专题学习材料', meta: ['学习材料', '06-12', '党支部'] },
      { id: 'safety', title: '校园安全责任清单学习', meta: ['制度文件', '06-05', '综合组'] },
      { id: 'meeting', title: '支部会议记录规范', meta: ['制度文件', '05-28', '党支部'] },
      { id: 'archive', title: '党员学习档案整理要求', meta: ['制度文件', '05-21', '办公室'] },
    ],
  },

  onItemTap(e) {
    wx.navigateTo({ url: `/pages/party-study-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
