/**
 * 党建活动 · 活动介绍 —— 原型 screens/party-activity-detail.html 的小程序版本。
 *
 * 原型按 `?id=` 从正文表和附件表取内容，取不到回落到 theme-day，口径照抄。
 * 附件在原型里是 data: URI 的示例文本，小程序下不了，改成弹提示。
 */

const ACTIVITIES = {
  'theme-day': {
    title: '“红色故事进课堂”主题党日', sub: '党建活动 · 多功能室', time: '06-20 15:00',
    body: '党员教师围绕红色故事资源进行课程转化讨论，形成适合大班幼儿理解的故事讲述、角色扮演和美术表达活动。',
  },
  volunteer: {
    title: '党员教师社区志愿服务', sub: '党建活动 · 社区广场', time: '06-14 09:30',
    body: '教师参与社区环境整理和亲子阅读角维护，将社区教育资源与园内课程主题进行连接。',
  },
  reading: {
    title: '青年教师理论读书会', sub: '党建活动 · 党建室', time: '06-07 16:20',
    body: '围绕儿童立场、师德规范与课程观察展开共读，每位教师提交一条教学实践反思。',
  },
  visit: {
    title: '红色教育基地参访', sub: '党建活动 · 区党群中心', time: '05-29 14:00',
    body: '参访区党群服务中心，整理适合幼儿园课程使用的红色教育素材。',
  },
  class: {
    title: '党员示范课观摩', sub: '党建活动 · 中三班', time: '05-16 10:00',
    body: '以科学探究活动为例，展示党员教师在课程设计和现场支持中的示范作用。',
  },
};

const FILES = {
  'theme-day': [
    { use: '活动方案', file: '红色故事进课堂主题党日活动方案.docx' },
    { use: '故事素材包', file: '适合幼儿讲述的红色故事素材.pdf' },
    { use: '教师分工表', file: '主题党日现场组织分工表.xlsx' },
  ],
  volunteer: [
    { use: '服务记录表', file: '党员教师社区志愿服务记录表.docx' },
    { use: '安全告知书', file: '社区志愿服务安全告知书.pdf' },
    { use: '照片归档清单', file: '活动照片与反馈归档清单.xlsx' },
  ],
  reading: [
    { use: '共读材料', file: '青年教师理论读书会共读材料.pdf' },
    { use: '交流记录模板', file: '读书会观点记录与反思模板.docx' },
    { use: '签到表', file: '青年教师理论读书会签到表.xlsx' },
  ],
  visit: [
    { use: '参访通知', file: '红色教育基地参访通知.docx' },
    { use: '学习任务单', file: '红色教育素材课程转化任务单.pdf' },
    { use: '总结模板', file: '参访学习总结模板.docx' },
  ],
  class: [
    { use: '示范课教案', file: '党员示范课活动教案.docx' },
    { use: '观摩记录表', file: '教师听评课观摩记录表.pdf' },
    { use: '评价汇总表', file: '示范课观摩评价汇总.xlsx' },
  ],
};

Page({
  data: {
    activity: ACTIVITIES['theme-day'],
    files: FILES['theme-day'],
  },

  onLoad(options) {
    const id = options.id && ACTIVITIES[options.id] ? options.id : 'theme-day';
    this.setData({ activity: ACTIVITIES[id], files: FILES[id] });
  },

  onDownload(e) {
    wx.showToast({ title: `${e.currentTarget.dataset.name}（预览工程未接入下载）`, icon: 'none' });
  },
});
