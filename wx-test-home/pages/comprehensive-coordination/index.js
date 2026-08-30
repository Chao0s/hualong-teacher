/**
 * 综合协调部 —— 原型 screens/comprehensive-coordination.html 的小程序版本。
 * 七个入口全部指向同一个文件列表页，靠 ?type= 区分。
 */

Page({
  data: {
    sections: [
      {
        title: '行政统筹', cols: 3,
        entries: [
          { type: 'policy', glyph: '政', tone: 'accent', title: '政策法规', desc: '政策文件与制度依据' },
          { type: 'notice', glyph: '通', tone: 'blue', title: '通知文件', desc: '园内通知与文件流转' },
          { type: 'org', glyph: '组', tone: 'amber', title: '组织架构', desc: '部门职责与人员分工' },
        ],
      },
      {
        title: '后勤保障', cols: 2,
        entries: [
          { type: 'safety', glyph: '安', tone: 'red', title: '安全管理', desc: '安全巡检、应急预案与记录' },
          { type: 'health', glyph: '卫', tone: 'green', title: '卫生保健', desc: '晨检、消毒与健康提醒' },
        ],
      },
      {
        title: '人事管理', cols: 2,
        entries: [
          { type: 'ethics', glyph: '德', tone: 'orange', title: '师德师风', desc: '学习记录、承诺书与考核材料' },
          { type: 'exchange', glyph: '岗', tone: 'blue', title: '跟岗交流', desc: '跟岗安排、交流记录与反馈' },
        ],
      },
    ],
  },

  onEntryTap(e) {
    wx.navigateTo({ url: `/pages/coordination-file-list/index?type=${e.currentTarget.dataset.type}` });
  },
});
