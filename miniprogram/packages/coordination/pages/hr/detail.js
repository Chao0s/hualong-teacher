/**
 * 人事资料详情页 — APP-STRUCTURE.md screen id `HRDetail`.
 *
 * Read-only. §2.3: a document outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 */

const guard = require('../../../../utils/guard');
const coordination = require('../../../../services/coordination');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    doc: null,
    documentId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const documentId = Number(query.document_id);
    if (!documentId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少资料编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, documentId });
    this.load(documentId);
  },

  onRetryLoad() {
    if (!this.data.documentId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.documentId);
  },

  async load(documentId) {
    try {
      const row = await coordination.documentDetail(documentId);
      this.setData({ doc: row, loading: false });
      if (row.document_title) {
        wx.setNavigationBarTitle({ title: row.document_title });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 取档每次现签一个短时 URL（§8.4）。打不开时的说明由服务层统一给。 */
  onOpenFile(e) {
    const { file } = e.currentTarget.dataset;
    return coordination.openFile(this.data.documentId, file);
  },
});
