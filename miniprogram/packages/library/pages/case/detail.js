/**
 * 案例详情页 — APP-STRUCTURE.md screen id `CaseDetail`.
 *
 * 三条路进这一页，全都带着 `case_id`：首页推荐课程案例卡片、资源详情的关联案例、
 * 案例列表的行。三条路走的是 services/library.js 的同一个出口，所以它们进的必然是
 * **同一个**案例详情页（票据 13 验收项）。
 *
 * Read-only. §2.3: a case outside the caller's scope comes back as 404, not
 * 403 — scope is hidden rather than confirmed, so this page treats "gone" and
 * "not yours" identically and says neither. That wording comes from the error
 * registry through reportFailure; nothing here composes it.
 *
 * 下载详案只调一次 `POST .../download-link`，服务端在同一个事务里记这一笔。
 * **本页不再发第二个「我看过了」的请求**（票据 13 验收项）。
 *
 * 教师自评、他评与活动反思在**详案文档里**，不是这一页上的三个字段 —— `db_case` 没有
 * 这三列，契约的 `Case` schema 也没有。原型 case-detail.html 同样把它们排在 Word 详案
 * 的第七、八、九节。所以这里由下载入口通向它们，不发明契约里没有的字段。
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,
    kase: null,
    caseId: 0,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const caseId = Number(query.case_id);
    if (!caseId) {
      // A missing id is the caller's bug; retrying the same URL changes nothing.
      this.setData({ ready: true, loading: false, errorText: '缺少案例编号', errorCanRetry: false });
      return;
    }
    this.setData({ ready: true, caseId });
    this.load(caseId);
  },

  onRetryLoad() {
    if (!this.data.caseId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.caseId);
  },

  async load(caseId) {
    try {
      const row = await library.caseDetail(caseId);
      this.setData({ kase: row, loading: false });
      if (row.case_name) {
        wx.setNavigationBarTitle({ title: row.case_name });
      }
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 详案下载。反馈由服务层统一给。 */
  onDownload() {
    library.downloadCaseWordFile(this.data.caseId);
  },

  /** 关联的课程资源。资源详情已落地，直接跳。 */
  onOpenResource(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/packages/library/pages/resource/detail?resource_id=${id}` });
  },
});
