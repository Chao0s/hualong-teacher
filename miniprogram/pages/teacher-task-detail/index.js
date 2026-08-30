/**
 * 任务详情 —— 原型 screens/teacher-task-detail.html 的小程序版本。
 *
 * 原型按 `?id=` 取任务，取不到回落到 resource-pack。
 * 两处行为照抄：
 *   1. 状态是「完成」时，任务操作和提交材料两块整块隐藏。
 *   2. 点「接受 / 完成」只改本页状态并弹提示，不落库。
 */

const TASKS = {
  'resource-pack': {
    source: '教研组发起',
    title: '衣食住行艺课程资源包共建',
    summary: '收集班级实践材料，形成可共享的课程资源与案例素材。',
    status: '待接收',
    background: '围绕衣、食、住、行、艺五类生活经验，整理幼儿园已有课程活动、资源照片和教师转化说明。材料将用于课程资源首页、资源库和案例库的后续建设。',
    roles: [
      { name: '大班组', work: '提交“住、行”相关活动照片、幼儿表达记录和教师说明。' },
      { name: '中班组', work: '提交“食、艺”相关材料包、幼儿作品和活动反思。' },
      { name: '教研组', work: '统一审核标题、标签、授权与课程转化路径。' },
    ],
    timeline: [
      { date: '6月22日', event: '接收任务并确认本班负责范畴' },
      { date: '6月26日', event: '上传图文材料、附件和教师说明' },
      { date: '6月30日', event: '完成审核修改并进入资源库 / 案例库候选' },
    ],
    files: [
      { name: '任务说明.docx', size: '2.4 MB' },
      { name: '材料命名规则.pdf', size: '1.2 MB' },
      { name: '提交清单.xlsx', size: '860 KB' },
    ],
  },

  'community-walk': {
    source: '年级组发起',
    title: '社区建筑观察活动材料提交',
    summary: '补充社区建筑观察的图文记录和教师转化说明。',
    status: '进行中',
    background: '基于幼儿园周边社区建筑和生活见闻，整理一次可转化为社会领域或语言领域的活动材料，重点呈现幼儿观察、提问和表达。',
    roles: [
      { name: '主班教师', work: '提交活动背景、照片和幼儿问题记录。' },
      { name: '配班教师', work: '补充活动过程中的安全组织和分组观察记录。' },
      { name: '年级组长', work: '审核材料是否能形成可复用案例。' },
    ],
    timeline: [
      { date: '6月20日', event: '完成社区踏查与素材拍摄' },
      { date: '6月25日', event: '提交班级图文材料' },
      { date: '6月27日', event: '根据审核意见补充说明' },
    ],
    files: [
      { name: '社区观察记录表.docx', size: '920 KB' },
      { name: '照片整理示例.pdf', size: '1.5 MB' },
      { name: '活动反馈模板.docx', size: '640 KB' },
    ],
  },

  'training-feedback': {
    source: '保教主任发起',
    title: '课程游戏化研修反馈汇总',
    summary: '提交研修学习记录和班级实践计划。',
    status: '完成',
    background: '本次研修聚焦课程游戏化中的材料投放、教师观察和支持策略。教师需将研修内容转化为一个可在班级执行的小行动。',
    roles: [
      { name: '全体教师', work: '提交学习记录和一条班级实践计划。' },
      { name: '教研组', work: '汇总教师共性问题，形成后续研修议题。' },
      { name: '保教主任', work: '筛选典型反馈进入教师成长档案。' },
    ],
    timeline: [
      { date: '6月12日', event: '完成研修并领取反馈表' },
      { date: '6月16日', event: '提交学习记录' },
      { date: '6月18日', event: '反馈汇总完成' },
    ],
    files: [
      { name: '研修反馈表.docx', size: '780 KB' },
      { name: '实践计划样例.pdf', size: '1.3 MB' },
      { name: '优秀反馈摘录.pdf', size: '1.1 MB' },
    ],
  },
};

Page({
  data: {
    task: TASKS['resource-pack'],
    // 任务操作那两个按钮的取值，和 task.status 比对决定哪个高亮
    states: ['已接受', '完成'],
    status: TASKS['resource-pack'].status,
  },

  onLoad(options) {
    const id = options.id && TASKS[options.id] ? options.id : 'resource-pack';
    this.setData({ task: TASKS[id], status: TASKS[id].status });
  },

  onStateTap(e) {
    const state = e.currentTarget.dataset.state;
    this.setData({ status: state });
    wx.showToast({ title: `状态已更新为：${state}`, icon: 'none' });
  },

  onToast(e) {
    wx.showToast({ title: e.currentTarget.dataset.action, icon: 'none' });
  },
});
