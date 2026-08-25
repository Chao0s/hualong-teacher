/**
 * 模块入口服务 — what each bottom-bar module offers (ticket 09).
 *
 * Four entry pages read this file. They are the same shape by design: a module
 * entry page is a list of section entries and nothing else, so the four pages
 * stay thin and this table is the single place an entry is added or renamed.
 *
 * THE ENTRIES FOLLOW THE STRUCTURE CONTRACT, NOT THE PROTOTYPES. `screen` names
 * the id in app-structure.json; where a prototype disagreed, the contract won.
 * Two disagreements are worth recording, because copying the prototype would
 * have been wrong both times:
 *
 *   1. home-school.html's 快捷入口 offers 社区共育, which links to
 *      community-coeducation.html — a PARENT-client screen (migration checklist,
 *      末节). It is not in the teacher's 45 and is deliberately absent here.
 *   2. The same prototype offers 成长档案 (growth-record.html), which the
 *      checklist records as having no screen in the contract. Left out until
 *      the contract says otherwise.
 *
 * A `page` of null means the screen is not built yet, and the tap is refused out
 * loud exactly as 首页 does (ticket 08). Tickets 12 to 21 fill them in — set
 * `page`, and the refusal disappears on its own. 学习资料 is the first one set
 * (ticket 12); the rest are still null.
 */

const guard = require('../utils/guard');

const MODULES = {
  'party-building': {
    title: '党建管理',
    groups: [
      {
        title: '资料与活动',
        entries: [
          { key: 'learn', badge: '学', label: '学习资料', desc: '新时代党建工作要点、师德师风材料', screen: 'LearnList', page: '/packages/party/pages/learn/list' },
          { key: 'activity', badge: '活', label: '活动', desc: '主题党日、志愿服务、青年教师读书会', screen: 'ActivityList', page: null },
          { key: 'brand', badge: '牌', label: '品牌建设', desc: '科技启蒙、醒狮文化、自然花园', screen: 'BrandList', page: null },
        ],
      },
    ],
  },

  'admin-coordination': {
    title: '综合协调',
    groups: [
      {
        title: '园务资料',
        entries: [
          { key: 'xz', badge: '行', label: '行政资料', desc: '政策法规、通知文件、组织架构', screen: 'XZList', page: null },
          { key: 'hq', badge: '后', label: '后勤资料', desc: '安全管理、卫生保健', screen: 'HQList', page: null },
          { key: 'hr', badge: '人', label: '人事资料', desc: '师德师风、跟岗交流', screen: 'HRList', page: null },
        ],
      },
    ],
  },

  'teaching-research': {
    title: '教研培训',
    groups: [
      {
        title: '课程与研修',
        entries: [
          { key: 'course', badge: '课', label: '办园理念与课程体系', desc: '课程建设的来龙去脉', screen: 'CourseIntroDetail', page: null },
          { key: 'train', badge: '研', label: '研修', desc: '研修安排、详情与反馈', screen: 'TrainList', page: null },
        ],
      },
      {
        title: '五大领域评价',
        entries: [
          { key: 'scale', badge: '量', label: '填写五大领域量表', desc: '按领域逐项打分', screen: 'Scale', page: null },
          { key: 'chart', badge: '维', label: '评价五维图', desc: '看已完成的评价结果', screen: 'FiveChart', page: null },
        ],
      },
    ],
  },

  'co-education': {
    title: '家园社共育',
    groups: [
      {
        title: '日常',
        entries: [
          { key: 'moment', badge: '时', label: '在园时光', desc: '发布与发布进度（只收图片）', screen: 'GardenPublish', page: null },
          { key: 'task', badge: '任', label: '亲子任务', desc: '发布任务、查看完成进度', screen: 'TaskPublish', page: null },
        ],
      },
      {
        title: '评价与成长册',
        entries: [
          { key: 'month', badge: '月', label: '月度评价', desc: '按月为每名幼儿填写', screen: 'MonthEval', page: null },
          { key: 'term', badge: '期', label: '学期评价', desc: '学期末的整体评价', screen: 'TermEval', page: null },
          { key: 'book', badge: '册', label: '成长册', desc: '生成与预览', screen: 'BookCreate', page: null },
        ],
      },
    ],
  },
};

/** The module's groups, ready to bind. */
function sectionsFor(moduleId) {
  const module = MODULES[moduleId];
  if (!module) throw new Error(`module-entry: 未知模块 "${moduleId}"`);
  return module.groups.map((group) => ({
    title: group.title,
    entries: group.entries.map((entry) => ({
      key: entry.key,
      badge: entry.badge,
      label: entry.label,
      desc: entry.desc,
    })),
  }));
}

/** The module's own name, for the navigation bar. */
function titleFor(moduleId) {
  const module = MODULES[moduleId];
  if (!module) throw new Error(`module-entry: 未知模块 "${moduleId}"`);
  return module.title;
}

/**
 * Act on an entry tap: navigate through the role gate, or say why not. Never
 * silence — a tap that does nothing is worse than a clear no.
 */
function openEntry(moduleId, key) {
  const module = MODULES[moduleId];
  if (!module) return;
  const entry = module.groups
    .reduce((all, group) => all.concat(group.entries), [])
    .find((e) => e.key === key);
  if (!entry) return;
  if (!entry.page) {
    wx.showToast({ title: `${entry.label}尚未上线`, icon: 'none' });
    return;
  }
  guard.navigateTo(entry.page, moduleId);
}

module.exports = {
  sectionsFor,
  titleFor,
  openEntry,
};
