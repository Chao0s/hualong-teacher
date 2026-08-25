/**
 * 资源详情页 — APP-STRUCTURE.md screen id `ResourceDetail`.
 *
 * Read-only. §2.3: a resource outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 *
 * 下载详案只调一次 `POST .../download-link`，服务端在同一个事务里记这一笔。
 * **本页不再发第二个「我看过了」的请求**（票据 13 验收项）。
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    resource: null,
    resourceId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const resourceId = Number(query.resource_id);
    if (!resourceId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少资源编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, resourceId });
    this.load(resourceId);
  },

  onRetryLoad() {
    if (!this.data.resourceId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.resourceId);
  },

  async load(resourceId) {
    try {
      const row = await library.resourceDetail(resourceId);
      this.setData({ resource: row, loading: false });
      if (row.resource_name) {
        wx.setNavigationBarTitle({ title: row.resource_name });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 详案下载。反馈由服务层统一给。 */
  onDownload() {
    library.downloadWordFile(this.data.resourceId);
  },

  /** 关联的课程案例。案例详情未落地时在跳转前被拦下并说明原因。 */
  onOpenCase(e) {
    library.openCase(e.currentTarget.dataset.id);
  },
});
