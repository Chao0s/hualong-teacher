/**
 * 党建学习 · 文件预览 —— 原型 screens/party-study-detail.html 的小程序版本。
 *
 * 原型用 `?id=` 从两张表里取内容（正文一张、相关视频一张），取不到就回落到
 * work-points。这里口径照抄。
 *
 * 「在线预览 / 下载文件」在原型里就是弹提示，不是真下载，照搬。
 * 视频链接原型用剪贴板 API，小程序对应 wx.setClipboardData。
 */

const DOCS = {
  'work-points': {
    type: '政策文件', title: '新时代幼儿园党建工作要点', date: '06-18', owner: '办公室',
    p1: '围绕党建引领幼儿园高质量发展，明确支部学习、党员示范岗、课程建设协同和家园社共育服务四项重点。',
    p2: '本文件用于教师端学习与园内归档，支持在线预览和下载后线下研读。',
  },
  discipline: {
    type: '学习材料', title: '师德师风专题学习材料', date: '06-12', owner: '党支部',
    p1: '聚焦教师职业行为规范、儿童保护责任和家园沟通边界，整理近期学习要点。',
    p2: '教师可在线预览主文件，也可下载后线下研读。',
  },
  safety: {
    type: '制度文件', title: '校园安全责任清单学习', date: '06-05', owner: '综合组',
    p1: '梳理班级晨检、户外活动、食品安全和离园交接中的责任节点。',
    p2: '适合在年级组会议前快速预览，并下载给班级教师对照执行。',
  },
  meeting: {
    type: '制度文件', title: '支部会议记录规范', date: '05-28', owner: '党支部',
    p1: '说明会议纪要、照片材料、签到表和学习反馈的归档要求。',
    p2: '用于统一会议材料的形成与保存规则。',
  },
  archive: {
    type: '制度文件', title: '党员学习档案整理要求', date: '05-21', owner: '办公室',
    p1: '规定学习文件命名、分类、责任人和提交时间。',
    p2: '用于统一园内党建学习材料的电子化沉淀。',
  },
};

const VIDEOS = {
  'work-points': [
    { name: '党建引领教育高质量发展', url: 'https://www.12371.cn/special/xxzd/' },
    { name: '新闻联播：教育强国相关报道', url: 'https://tv.cctv.com/lm/xwlb/' },
  ],
  discipline: [
    { name: '师德师风专题学习', url: 'https://www.xuexi.cn/' },
    { name: '榜样人物学习视频', url: 'https://www.12371.cn/special/by/' },
  ],
  safety: [
    { name: '校园安全公开课', url: 'https://tv.cctv.com/' },
    { name: '安全教育专题视频', url: 'https://www.xuexi.cn/' },
  ],
  meeting: [
    { name: '基层党建工作案例', url: 'https://www.12371.cn/' },
    { name: '会议记录规范学习', url: 'https://www.xuexi.cn/' },
  ],
  archive: [
    { name: '党员教育管理学习', url: 'https://www.12371.cn/special/xxzd/' },
    { name: '资料归档与组织生活学习', url: 'https://www.xuexi.cn/' },
  ],
};

Page({
  data: {
    doc: DOCS['work-points'],
    videos: VIDEOS['work-points'],
  },

  onLoad(options) {
    const id = options.id && DOCS[options.id] ? options.id : 'work-points';
    this.setData({ doc: DOCS[id], videos: VIDEOS[id] });
    wx.setNavigationBarTitle({ title: '文件预览' });
  },

  onAction(e) {
    wx.showToast({
      title: `${e.currentTarget.dataset.action}：示例反馈，后续接入真实附件`,
      icon: 'none',
    });
  },

  onCopyUrl(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.url,
      success: () => wx.showToast({ title: '链接已复制，请到浏览器打开', icon: 'none' }),
    });
  },
});
