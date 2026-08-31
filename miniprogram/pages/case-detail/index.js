/**
 * 案例详情 —— 数据来自 `GET /library/cases/{case_id}`。
 *
 * 两段正文对应 `db_case` 的两列：`case_intro`（活动简介）与 `case_trans`
 * （活动转化）。小标题逐字保留。
 *
 * ── 原型那份 60 块的「Word版完整详案」已经删掉，它不是页面上的数据 ──────────
 *
 * 原型在这一页下半屏渲染了一整份教案：活动目标、材料准备表格、六个环节、
 * 七/八/九三节自评他评反思、十、相关资源。**`db_case` 没有任何一列存这些。**
 * 契约的 `Case` schema 也只有 `case_intro` 与 `case_trans` 两段正文。
 *
 * 那份教案的真身是 `word_file_id` 指向的 .docx 文件 —— 原型把文件正文抄成了
 * 网页，看起来像页面字段，实际是附件内容。所以这里的做法是：**删掉那份抄件，
 * 把「下载Word详案」接到 `POST /library/cases/{case_id}/download-link`**，
 * 而不是发明九个契约里没有的字段去把它填回来。
 *
 * 预览环境（db/testdata 的契约服务端）**不接对象存储**：它会真的做完取档授权，
 * 然后回一个明确标注为假的 URL。所以这里点下去会说明这一点，不谎报成功，也不
 * 报成失败 —— 授权确实过了。
 */

const library = require('../../services/library');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    title: '',
    tags: [],
    sections: [],
    relatedResources: [],
    hasPlan: false,
    loading: true,
    error: '',
  },

  onLoad(options) {
    const id = Number(options.id);
    if (!id) {
      this.setData({ loading: false, error: '缺少案例编号，请从案例库进入。' });
      return;
    }
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const detail = await library.getCase(this.data.id);
      this.setData({
        title: detail.title,
        tags: detail.tags,
        sections: detail.sections,
        relatedResources: detail.relatedResources,
        // 没有附件的案例照常显示，只是不出现下载入口。
        hasPlan: Boolean(detail.wordFileId),
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || '案例加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onResourceTap(e) {
    wx.navigateTo({ url: `/pages/resource-detail/index?id=${e.currentTarget.dataset.id}` });
  },

  async onDownloadPlan() {
    wx.showLoading({ title: '正在取档', mask: true });
    try {
      const link = await library.downloadLink('case', this.data.id);
      wx.hideLoading();
      if (link.placeholder) {
        // 授权过了，但这个环境没有对象存储。说清楚是哪一件事，别让人以为没权限。
        wx.showModal({
          title: '取档授权已通过',
          content: '预览环境不接对象存储，因此没有真实文件可下。接上正式环境后，这里会直接下载 Word 详案。',
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      wx.downloadFile({
        url: link.url,
        success: (res) => wx.openDocument({ filePath: res.tempFilePath, fileType: 'docx' }),
        fail: () => wx.showToast({ title: '文件下载失败，请稍后重试', icon: 'none' }),
      });
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '取档失败，请稍后重试', icon: 'none' });
    }
  },
});
