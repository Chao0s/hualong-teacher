/**
 * 品牌建设详情页 — APP-STRUCTURE.md screen id `BrandDetail`.
 *
 * Read-only. §2.3: a brand record outside the caller's scope comes back as 404,
 * not 403 — scope is hidden rather than confirmed, so this page treats "gone"
 * and "not yours" identically and says neither.
 */

const guard = require('../../../../utils/guard');
const party = require('../../../../services/party');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    brand: null,
    brandId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const brandId = Number(query.brand_id);
    if (!brandId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少资料编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, brandId });
    this.load(brandId);
  },

  onRetryLoad() {
    if (!this.data.brandId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.brandId);
  },

  async load(brandId) {
    try {
      const row = await party.brandDetail(brandId);
      this.setData({ brand: row, loading: false });
      if (row.brand_title) {
        wx.setNavigationBarTitle({ title: row.brand_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 点开一张图文素材。地址已经签好了，这一步不再跑网络。 */
  onPhotoTap(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    const urls = (this.data.brand.photos || []).map((p) => p.url);
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[index] });
  },
});
