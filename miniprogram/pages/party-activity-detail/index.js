/**
 * 党建活动 · 活动介绍 —— 数据来自 `GET /party/activities/{activity_id}`。
 *
 * 原型把 5 场活动的正文和 5 组共 15 个附件写死在这个文件里；已经全部删掉。
 *
 * ── 附件那一块为什么现在多半是空的 ─────────────────────────────────────────
 *
 * 原型的附件是「红色故事进课堂主题党日活动方案.docx」这样的**文件名**。契约的
 * `PartyActivity.file_refs` 只回 `{file_id, usage_key}`，**没有文件名这一列**；
 * 而且数据集里三场已发布活动的 `file_refs` 全是空数组。
 *
 * 所以这一块：有附件就按用途（usage_key）列出来，没有就整块不渲染。**不编文件名**
 * —— 编出来的名字点下去下不到那个文件，比不显示更糟。
 *
 * 另外党建这一族在契约里**没有取档端点**（资源与案例有 `/download-link`，
 * 这一族没有），所以即便将来有了 file_refs，点下载也还需要契约先补一条。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    activity: null,
    files: [],
    loading: true,
    error: '',
  },

  onLoad(options) {
    const id = Number(options.id);
    if (!id) {
      this.setData({ loading: false, error: '缺少活动编号，请从党建活动列表进入。' });
      return;
    }
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const activity = await party.getActivity(this.data.id);
      this.setData({
        activity: {
          title: activity.title,
          sub: activity.sub,
          time: activity.time,
          body: activity.body,
        },
        files: activity.files,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || '活动加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onDownload(e) {
    wx.showToast({
      title: `${e.currentTarget.dataset.name}：党建附件的取档接口尚未开放`,
      icon: 'none',
    });
  },
});
