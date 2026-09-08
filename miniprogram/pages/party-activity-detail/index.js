/**
 * 党建活动 · 活动介绍 —— 数据来自 `GET /party/activities/{activity_id}`。
 *
 * 原型把 5 场活动的正文和 5 组共 15 个附件写死在这个文件里；已经全部删掉。
 *
 * ── 附件那一块为什么现在多半是空的 ─────────────────────────────────────────
 *
 * 原型的附件是「红色故事进课堂主题党日活动方案.docx」这样的**文件名**，写死在
 * 页面里。数据集里三场已发布活动的 `file_refs` 都是空数组，所以这一块多半不渲染。
 *
 * 有附件时按 `ContentFileRef.file_name` 的真名列出来，没有就整块不渲染。
 * **不编文件名** —— 编出来的名字点下去下不到那个文件，比不显示更糟。
 *
 * ── 附件怎么取 ─────────────────────────────────────────────────────────────
 *
 * 附件走 `GET /media/files/{file_id}/url`，宿主是 `db_party_activity`。这是媒体流的
 * 唯一路径：按家族各开一条取档端点在 2026-08-20 拒过（`docs/API-CONTRACT.md:641`）。
 *
 * 成功取档时服务端在同一事务里记一笔 `downloaded`（k4，§4 规则 19／20／21），
 * **重复点重复计数**。
 */

const party = require('../../services/party');
const media = require('../../services/media');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    activity: null,
    files: [],
    fileOwner: null,
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
        fileOwner: activity.fileOwner,
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

  /**
   * 下载一个附件。**「下载」与「预览」在小程序上是同一件事**（下到临时文件再
   * `wx.openDocument`），这一页只有一个按钮，走的就是那条路。
   */
  async onDownload(e) {
    const fileId = Number(e.currentTarget.dataset.fileid);
    wx.showLoading({ title: '正在取档', mask: true });
    try {
      const r = await media.openFile(fileId, this.data.fileOwner);
      wx.hideLoading();
      if (r.placeholder) {
        // 授权过了，但这个环境没有对象存储。说清楚是哪一件事，别让人以为没权限。
        wx.showModal({
          title: '取档授权已通过',
          content: r.reason,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      if (!r.opened) wx.showToast({ title: r.reason, icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '取档失败，请稍后重试', icon: 'none' });
    }
  },
});
