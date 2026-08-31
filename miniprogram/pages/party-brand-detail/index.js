/**
 * 品牌建设 · 图文介绍 —— 数据来自 `GET /party/brands/{brand_id}`。
 *
 * 原型把 4 个品牌的标题、副标题、标签和正文写死在这里；已经全部删掉。
 *
 * ── 两处对得上，一处对不上 ─────────────────────────────────────────────────
 *
 * 对得上：`chips` 就是 `db_party_brand.brand_tag`（TEXT[]），`body` 就是
 * `brand_content`。副标题原型写的是「科学探究 · 园本特色」，取前两个标签拼出来，
 * 与原型同形。
 *
 * 对不上：原型的「图文素材」是四个写着「环境图／活动图／作品图／记录图」的占位
 * 色块，没有任何数据源。契约的 `PartyBrand.file_refs` 只回 `{file_id, usage_key}`，
 * 数据集里这一条的 file_refs 也是空的。所以整块跟着 file_refs 走，没有就不画 ——
 * 四个写着「图」的方块会让人以为这里有四张图。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    brand: null,
    files: [],
    loading: true,
    error: '',
  },

  onLoad(options) {
    const id = Number(options.id);
    if (!id) {
      this.setData({ loading: false, error: '缺少品牌编号，请从品牌建设列表进入。' });
      return;
    }
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const brand = await party.getBrand(this.data.id);
      this.setData({
        brand: {
          title: brand.title,
          sub: brand.sub,
          chips: brand.chips,
          body: brand.body,
        },
        files: brand.files,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || '品牌主题加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },
});
