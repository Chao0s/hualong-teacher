/**
 * 综合协调 · 文件列表 —— 原型 screens/coordination-file-list.html 的小程序版本。
 *
 * 七类文件共用这一页，靠 `?type=` 选。原型把七类的目录写死在脚本里，这里照搬。
 * 分页口径照抄：每页 3 条，点「加载更多」再放 3 条，放满就隐藏按钮。
 * 附件在原型里是 data: URI 的示例文本，小程序下不了，改成弹提示。
 */

const PAGE_SIZE = 3;

const CATALOG = {
  policy: {
    title: '政策法规',
    docs: [
      { title: '幼儿园保教质量评估指南摘编', kind: '政策解读', date: '2026-06-18', summary: '摘录保教质量评估中与一日生活、师幼互动、课程实施直接相关的条目，便于班级教师对照自查。' },
      { title: '学前教育法学习要点', kind: '法规学习', date: '2026-06-11', summary: '围绕依法办园、儿童权益保护、家园协同和教师职责四个部分整理核心要点。' },
      { title: '园内安全责任制度修订稿', kind: '制度文件', date: '2026-05-30', summary: '明确班级、年级组、后勤与行政岗位在安全管理中的责任边界和上报流程。' },
      { title: '师幼活动审批流程说明', kind: '流程规范', date: '2026-05-22', summary: '用于户外活动、外出参访、家长开放日等活动前的审批材料准备与节点确认。' },
      { title: '教育收费公示与资料留存规范', kind: '行政规范', date: '2026-05-09', summary: '说明收费公示、家长确认、票据保存和资料归档的基本要求。' },
    ],
  },
  notice: {
    title: '通知文件',
    docs: [
      { title: '六月园务例会通知', kind: '会议通知', date: '2026-06-20', summary: '通知各部门负责人参加六月园务例会，并提前提交本月工作进展和下月重点事项。' },
      { title: '期末资料归档工作提醒', kind: '工作通知', date: '2026-06-17', summary: '提醒各班完成成长档案、活动方案、家长沟通记录等资料的整理与归档。' },
      { title: '端午节后勤值班安排', kind: '值班安排', date: '2026-06-08', summary: '列明节前检查、假期值班、应急联系人和返园前环境整理要求。' },
      { title: '家长开放日协同事项', kind: '活动通知', date: '2026-05-26', summary: '明确开放日当天接待、签到、拍摄、秩序维护和活动反馈的部门分工。' },
      { title: '班级物资申领时间调整通知', kind: '行政通知', date: '2026-05-15', summary: '说明物资申领表提交时间、审批路径和领取窗口调整。' },
    ],
  },
  org: {
    title: '组织架构',
    docs: [
      { title: '综合协调部岗位职责表', kind: '岗位说明', date: '2026-06-16', summary: '列出行政统筹、后勤保障、人事支持等岗位的主要职责和协作对象。' },
      { title: '园级管理小组分工图', kind: '组织架构', date: '2026-06-10', summary: '展示园长室、教研培训、党建管理、综合协调与家园社共育之间的工作关系。' },
      { title: '年级组长工作职责说明', kind: '岗位说明', date: '2026-05-28', summary: '明确年级组长在课程推进、教师支持、家园沟通和资料提交中的职责。' },
      { title: '跨部门事项流转清单', kind: '流程清单', date: '2026-05-19', summary: '用于确认通知发布、活动保障、物资调配和人员协调的流转路径。' },
      { title: '临时工作小组成立模板', kind: '模板文件', date: '2026-05-06', summary: '提供活动筹备、项目推进或专项检查时成立临时小组的文件模板。' },
    ],
  },
  safety: {
    title: '安全管理',
    docs: [
      { title: '每日安全巡检记录表', kind: '检查表', date: '2026-06-21', summary: '用于门岗、楼道、活动室、户外场地和消防通道的日常检查记录。' },
      { title: '户外活动安全提示单', kind: '安全提示', date: '2026-06-14', summary: '整理高温、雨后、器械使用和幼儿分组看护的注意事项。' },
      { title: '防汛防台应急预案', kind: '应急预案', date: '2026-06-03', summary: '明确预警接收、场地排查、人员联络、物资准备和停课研判流程。' },
      { title: '校车交接流程记录', kind: '交接记录', date: '2026-05-24', summary: '规范幼儿乘车名单核对、到离园交接、异常情况反馈和家长确认。' },
      { title: '安全演练反馈汇总表', kind: '反馈表', date: '2026-05-12', summary: '用于记录演练时间、参与班级、发现问题和后续整改措施。' },
    ],
  },
  health: {
    title: '卫生保健',
    docs: [
      { title: '班级晨午检记录表', kind: '健康记录', date: '2026-06-19', summary: '记录幼儿体温、精神状态、皮肤口腔观察和异常跟进情况。' },
      { title: '夏季传染病防控提醒', kind: '健康提醒', date: '2026-06-12', summary: '围绕手足口、疱疹性咽峡炎、肠胃不适等情况说明观察与上报要点。' },
      { title: '活动室消毒流程卡', kind: '操作流程', date: '2026-06-04', summary: '列出桌面、玩具、寝具、盥洗区和空气消毒的频次与责任人。' },
      { title: '幼儿饮水与户外补水建议', kind: '保健建议', date: '2026-05-27', summary: '说明高温季节饮水提醒、补水记录和户外活动时间调整建议。' },
      { title: '体检数据异常跟进表', kind: '跟进表', date: '2026-05-10', summary: '用于保健老师与班级教师共同记录体检异常提示和家长沟通情况。' },
    ],
  },
  ethics: {
    title: '师德师风',
    docs: [
      { title: '教师职业行为准则学习材料', kind: '学习材料', date: '2026-06-18', summary: '整理教师日常言行、家长沟通、幼儿保护和信息发布中的底线要求。' },
      { title: '师德承诺书模板', kind: '模板文件', date: '2026-06-05', summary: '用于教师个人签署师德承诺，包含教育行为、沟通方式和隐私保护条目。' },
      { title: '师德师风月度自查表', kind: '自查表', date: '2026-05-31', summary: '围绕班级管理、活动组织、同伴协作和家长反馈进行月度自查。' },
      { title: '典型案例学习记录', kind: '案例学习', date: '2026-05-20', summary: '提供师德警示案例的学习记录模板，便于年级组讨论与留档。' },
      { title: '教师荣誉与表彰申报表', kind: '申报表', date: '2026-05-08', summary: '用于汇总教师在课程、家园社共育、教研和志愿服务中的表现材料。' },
    ],
  },
  exchange: {
    title: '跟岗交流',
    docs: [
      { title: '跟岗教师一周安排表', kind: '安排表', date: '2026-06-17', summary: '列出跟岗教师每日观摩班级、参与活动、复盘会议和材料提交要求。' },
      { title: '外出学习反馈模板', kind: '反馈模板', date: '2026-06-09', summary: '用于教师外出学习后整理亮点、可迁移经验和园内实践建议。' },
      { title: '结对教师交流记录', kind: '交流记录', date: '2026-05-29', summary: '记录结对教师围绕课程实施、区域观察和家长沟通的交流内容。' },
      { title: '教师轮岗申请表', kind: '申请表', date: '2026-05-18', summary: '用于教师提出轮岗、跟班或跨年级观摩申请，并说明学习目标。' },
      { title: '跟岗成果分享清单', kind: '成果清单', date: '2026-05-07', summary: '梳理跟岗结束后需要提交的照片、案例、反思和分享汇报材料。' },
    ],
  },
};

// 原型只给这三类的详情补一句「生效日期：未填写」
const WITH_EFFECTIVE_DATE = ['policy', 'safety', 'health'];

Page({
  data: {
    type: 'policy',
    visible: [],
    hasMore: false,
    preview: null,
  },

  onLoad(options) {
    const type = options.type && CATALOG[options.type] ? options.type : 'policy';
    this.docs = CATALOG[type].docs;
    this.setData({ type });
    wx.setNavigationBarTitle({ title: CATALOG[type].title });
    this.showUpTo(PAGE_SIZE);
  },

  onLoadMore() {
    this.showUpTo(this.data.visible.length + PAGE_SIZE);
  },

  showUpTo(count) {
    const visible = this.docs.slice(0, Math.min(count, this.docs.length));
    this.setData({ visible, hasMore: visible.length < this.docs.length });
  },

  onPreview(e) {
    const doc = this.data.visible[e.currentTarget.dataset.index];
    const effective = WITH_EFFECTIVE_DATE.includes(this.data.type) ? ' · 生效日期：未填写' : '';
    this.setData({
      preview: { title: doc.title, meta: `${doc.kind} · 发布于 ${doc.date}${effective}`, summary: doc.summary },
    });
  },

  onClosePreview() {
    this.setData({ preview: null });
  },

  onDownload(e) {
    wx.showToast({ title: `${e.currentTarget.dataset.title}（预览工程未接入下载）`, icon: 'none' });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
