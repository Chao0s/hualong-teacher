/**
 * 党建管理部 —— 数据来自 `/party/studies`、`/party/activities`、`/party/brands`。
 *
 * 原型把轮播 3 条 + 三块各 3 条共 12 条内容写死在这个文件里；已经全部删掉。
 *
 * 三块列表（党建学习 / 党建活动 / 品牌建设）在原型里是三段结构相同的 HTML，
 * 这里仍合成一份 groups 数据循环渲染。只有党建学习那块右侧是「预览/下载」两个
 * 胶囊，另外两块是箭头，靠 group.key 分 —— 这一条没变。
 *
 * ── 轮播为什么就是最新三条学习文件 ─────────────────────────────────────────
 *
 * 契约的 `PartyHome.carousel` 写得很清楚：本园 `study_status='s3'`，
 * 按 `published_at DESC, study_id DESC` 取 3，**是派生结果，不是可管理的推荐清单**
 * （F7 已拔除 `db_party_feature`，不得重建）。所以这里不做「精选」「置顶」之类的
 * 入口，也没有地方可以挑内容 —— 挑的能力在数据模型上就不存在。
 *
 * 底图色 b1/b2/b3 是三档配色，原型按位置轮着来，与内容无关，照旧按下标取。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

// 各块的「全部」页和详情页
const ROUTES = {
  study: { list: '/pages/party-study-list/index', detail: '/pages/party-study-detail/index' },
  activity: { list: '/pages/party-activity-list/index', detail: '/pages/party-activity-detail/index' },
  brand: { list: '/pages/party-brand-list/index', detail: '/pages/party-brand-detail/index' },
};

// 轮播底图的三档配色，按位置轮取。
const TONES = ['b1', 'b2', 'b3'];

Page({
  data: {
    bannerIndex: 0,
    banners: [],
    groups: [],
    loading: true,
    error: '',
  },

  onLoad() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const home = await party.home();
      this.setData({
        banners: home.carousel.map((s, i) => ({
          id: s.id,
          tone: TONES[i % TONES.length],
          title: s.title,
          sub: `${s.type} · ${s.date} · 点击查看最近发布的学习文件`,
        })),
        groups: [
          { key: 'study', title: '党建学习', glyph: '学', items: home.studies },
          { key: 'activity', title: '党建活动', glyph: '活', items: home.activities },
          {
            key: 'brand',
            title: '品牌建设',
            glyph: '品',
            // 品牌卡的 meta 在服务层是一个字符串（两个标签拼的），这一页的模板
            // 要的是数组，就地包一层，不为了这一处去改服务层的返回形状。
            items: home.brands.map((b) => ({ ...b, meta: ['主题图文'].concat(b.tags.slice(0, 2)) })),
          },
        ],
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        banners: [],
        groups: [],
        error: err.userMessage || '党建内容加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
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
