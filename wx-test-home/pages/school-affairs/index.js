/**
 * 党建管理部 —— 原型 screens/school-affairs.html 的小程序版本。
 *
 * 三块列表（党建学习 / 党建活动 / 品牌建设）在原型里是三段结构相同的 HTML，
 * 这里合成一份 groups 数据循环渲染。只有党建学习那块右侧是「预览/下载」两个胶囊，
 * 另外两块是箭头，靠 group.key 分。
 */

// 各块的「全部」页和详情页
const ROUTES = {
  study: { list: '/pages/party-study-list/index', detail: '/pages/party-study-detail/index' },
  activity: { list: '/pages/party-activity-list/index', detail: '/pages/party-activity-detail/index' },
  brand: { list: '/pages/party-brand-list/index', detail: '/pages/party-brand-detail/index' },
};

Page({
  data: {
    bannerIndex: 0,
    banners: [
      { id: 'work-points', tone: 'b1', title: '新时代幼儿园党建工作要点', sub: '政策文件 · 06-18 · 点击查看最近发布的学习文件' },
      { id: 'discipline', tone: 'b2', title: '师德师风专题学习材料', sub: '学习材料 · 06-12 · 点击查看最近发布的学习文件' },
      { id: 'safety', tone: 'b3', title: '校园安全责任清单学习', sub: '制度文件 · 06-05 · 点击查看最近发布的学习文件' },
    ],

    groups: [
      {
        key: 'study', title: '党建学习', glyph: '学',
        items: [
          { id: 'work-points', title: '新时代幼儿园党建工作要点', meta: ['政策文件', '06-18', '办公室'] },
          { id: 'discipline', title: '师德师风专题学习材料', meta: ['学习材料', '06-12', '党支部'] },
          { id: 'safety', title: '校园安全责任清单学习', meta: ['制度文件', '06-05', '综合组'] },
        ],
      },
      {
        key: 'activity', title: '党建活动', glyph: '活',
        items: [
          { id: 'theme-day', title: '“红色故事进课堂”主题党日', meta: ['活动介绍', '06-20', '多功能室'] },
          { id: 'volunteer', title: '党员教师社区志愿服务', meta: ['活动介绍', '06-14', '社区广场'] },
          { id: 'reading', title: '青年教师理论读书会', meta: ['活动介绍', '06-07', '党建室'] },
        ],
      },
      {
        key: 'brand', title: '品牌建设', glyph: '品',
        items: [
          { id: 'steam', title: '科技启蒙：小小工程师项目', meta: ['主题图文', '科学探究', '园本特色'] },
          { id: 'dragon', title: '醒狮文化：岭南艺术体验', meta: ['主题图文', '艺术表达', '本土课程'] },
          { id: 'garden', title: '自然花园：劳动教育实践', meta: ['主题图文', '劳动教育', '班级共建'] },
        ],
      },
    ],
  },

  onBannerChange(e) {
    this.setData({ bannerIndex: e.detail.current });
  },

  onStudyTap(e) {
    wx.navigateTo({ url: `${ROUTES.study.detail}?id=${e.currentTarget.dataset.id}` });
  },

  onMoreTap(e) {
    wx.navigateTo({ url: ROUTES[e.currentTarget.dataset.key].list });
  },

  onItemTap(e) {
    const { key, id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `${ROUTES[key].detail}?id=${id}` });
  },
});
