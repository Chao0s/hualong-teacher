/** 待办任务 —— 原型 screens/teacher-tasks.html 的小程序版本。 */

Page({
  data: {
    groups: [
      {
        title: '当前任务',
        tasks: [
          {
            id: 'resource-pack', state: 'wait', stateText: '待接收',
            title: '衣食住行艺课程资源包共建',
            meta: '截止 6月28日 · 教研组发起',
            summary: '围绕五类生活经验收集班级实践材料，形成可进入资源库和案例库的素材包。',
            pills: ['背景信息', '分工要求', '时间节点'],
          },
          {
            id: 'community-walk', state: 'doing', stateText: '进行中',
            title: '社区建筑观察活动材料提交',
            meta: '截止 6月25日 · 年级组发起',
            summary: '补充幼儿观察社区建筑的照片、记录和教师转化说明。',
            pills: ['照片材料', '观察记录', '活动反馈'],
          },
        ],
      },
      {
        title: '历史任务',
        tasks: [
          {
            id: 'training-feedback', state: 'done', stateText: '完成',
            title: '课程游戏化研修反馈汇总',
            meta: '6月18日已完成 · 保教主任发起',
            summary: '提交研修学习记录、班级实践计划和一条可推广经验。',
            pills: ['研修材料', '反馈表', '已归档'],
          },
        ],
      },
    ],
  },

  onTaskTap(e) {
    wx.navigateTo({ url: `/pages/teacher-task-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
