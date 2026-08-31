/**
 * 资源详情 —— 数据来自 `GET /library/resources/{resource_id}`。
 *
 * 原型把「沙湾留耕堂」那一条的三段正文写死在这里；已经删掉。三段正文对应
 * `db_resource` 的三列：`resource_explain`／`resource_access`／`resource_trans`，
 * 小标题（资源解读／资源获取／资源转化）逐字保留。
 *
 * ── 「课程应用」这一节现在是空的，这是事实不是遗漏 ──────────────────────────
 *
 * 原型在这里放了两张关联案例卡。方向要看清楚：`db_case.resource_ids` 记着**案例
 * 引用了哪些资源**，`db_resource` 上没有反向列，契约的 `Resource` schema 也没有。
 * 所以「这个资源被哪些案例用了」在服务端答不出来，客户端更拼不出来 ——
 * `/library/cases` 没有 `resource_id` 这个筛选参数。
 *
 * 于是这一节在没有数据时**整节不渲染**，而不是画两张空卡或编两条出来。编出来的
 * 关联会把教师引向一条不存在的关系。这条缺口记在 services/library 的头注里。
 */

const library = require('../../services/library');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    title: '',
    tags: [],
    sections: [],
    links: [],
    loading: true,
    error: '',
  },

  onLoad(options) {
    const id = Number(options.id);
    if (!id) {
      // 没带 id 就进来了，多半是某个入口还没接上。说一句中文，不白屏。
      this.setData({ loading: false, error: '缺少资源编号，请从资源库进入。' });
      return;
    }
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const detail = await library.getResource(this.data.id);
      this.setData({
        title: detail.title,
        tags: detail.tags,
        sections: detail.sections,
        links: detail.links,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        // §2.3：不在可见范围内与不存在同为 404。这里照它的原话说，不改口径成
        // 「无权限」——那会把「有这条但你看不到」泄漏出去。
        error: err.userMessage || '资源加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onLinkTap(e) {
    wx.navigateTo({ url: `/pages/case-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
