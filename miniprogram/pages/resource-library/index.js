/**
 * 资源库 —— 数据来自 `GET /library/resources`。
 *
 * 原型把 12 条资源连同它们的图标写死在这个文件里；那 12 条已经删掉，页面现在
 * 只负责画结构与收手势，取数与译枚举都在 services/library。
 *
 * ── 两种筛选，两个地方做，理由不同 ─────────────────────────────────────────
 *
 * **分类走服务端**：契约给了 `resource_tag` 这个参数，那就用它。在客户端过滤
 * 意味着先把全部资源取回来，资源上千时这条路走不通。
 *
 * **搜索走客户端**：契约的资源列表**没有搜索参数**（只有 `resource_tag`、
 * `grade`、`resource_status`、`class_id`）。所以这里对已取回的那一页做匹配，
 * 口径照抄原型：名称或分类包含搜索词。数据集是 12 条，一页取尽，行为与原型一致；
 * 资源上千之后这个搜索框需要契约先加一个参数，客户端补不出来。这条记在
 * services/library 的头注里。
 */

const library = require('../../services/library');
const guard = require('../../utils/guard');

// 一页取尽：db_resource 只有 12 行，且搜索要在已取回的集合上做。
// §3.1 的上限是 100。
const PAGE_LIMIT = 100;

Page({
  data: {
    // 取值来自服务层的同一份枚举表，页面不再自己抄一份「衣食住行艺」
    tags: ['all'],
    activeTag: 'all',
    query: '',
    items: [],
    visible: [],
    countText: '',
    loading: true,
    error: '',
  },

  /** 从课程资源页搜索跳过来时带着 q 参数，原型也是这么传的。 */
  onLoad(options) {
    this.setData({
      query: options.q ? decodeURIComponent(options.q) : '',
      tags: ['all'].concat(
        library.tagFilters().filter((t) => t.key).map((t) => t.label)
      ),
    });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const tag = this.data.activeTag === 'all' ? '' : this.data.activeTag;
      const page = await library.listResources({ tag, limit: PAGE_LIMIT });
      this.setData({ items: page.items, loading: false });
      this.applyFilter();
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        items: [],
        visible: [],
        countText: '',
        // ApiError.userMessage 已经是中文，页面不再翻一次错误码。
        error: err.userMessage || '资源加载失败，请稍后重试',
      });
    }
  },

  onTagTap(e) {
    this.setData({ activeTag: e.currentTarget.dataset.tag });
    // 分类是服务端筛的，改了就得重取
    this.load();
  },

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
    // 搜索是客户端做的，不重取
    this.applyFilter();
  },

  onRetry() {
    this.load();
  },

  /** 只做搜索词匹配；分类已经在服务端筛过了。 */
  applyFilter() {
    const tag = this.data.activeTag;
    const query = this.data.query.trim().toLowerCase();
    const visible = this.data.items.filter((entry) => (
      !query
      || entry.name.toLowerCase().includes(query)
      || entry.tagLabel.includes(query)
    ));
    this.setData({
      visible,
      countText: tag === 'all' ? `${visible.length} 个资源` : `${tag} · ${visible.length} 个`,
    });
  },

  onEntryTap(e) {
    wx.navigateTo({ url: `/pages/resource-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
