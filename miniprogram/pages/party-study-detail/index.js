/**
 * 党建学习 · 文件预览 —— 数据来自 `GET /party/studies/{study_id}`。
 *
 * 原型把 5 份文件的正文（每份两段）和 5 组共 10 条视频链接写死在这个文件里；
 * 已经全部删掉。
 *
 * ── 三处按数据实情做的改动 ─────────────────────────────────────────────────
 *
 * 1. **正文不再是固定两段。** `db_party_study` 只有一列 `study_content`，契约的
 *    `PartyStudy` 亦然；原型的 p1/p2 是把一段话拆成两半写的。服务层按空行切段，
 *    有几段渲染几段 —— 不硬凑成两段。
 *
 * 2. **「PDF · 2.4MB」删掉了。** 那是写死在模板里的一串字，对每份文件都不对。
 *    真的类型与大小在 `db_file` 上，`ContentFileRef` 也回（`file_type`／
 *    `file_size`），取档回包里同样有一份 —— 要显示的话从那里取，不要再写常数。
 *
 * 3. **视频可能一条也没有。** `video_links` 是可空列（三份材料里就有一份是 null），
 *    没有视频时整块不渲染，而不是画一个空的「相关视频学习」标题。
 *
 * ── 「在线预览 / 下载文件」两个按钮走同一条链接 ─────────────────────────────
 *
 * 附件走 `GET /media/files/{file_id}/url`，宿主是 `db_party_study`。这是媒体流的
 * 唯一路径：按家族各开一条取档端点在 2026-08-20 拒过（`docs/API-CONTRACT.md:641`）。
 *
 * 小程序上「预览」就是「下到 tempFilePath 再 wx.openDocument」—— 平台没有第二种
 * 打开方式。所以两个按钮调**同一个函数、拿同一条链接**，不是两条路径。
 *
 * 成功取档时服务端在同一事务里记一笔 `downloaded`（k3，§4 规则 19／20／21），
 * **重复点重复计数**，这是规则要的，不是重复提交。
 */

const party = require('../../services/party');
const media = require('../../services/media');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    doc: null,
    videos: [],
    // 主文件。没有附件的学习材料照常显示，只是不出现那两个按钮。
    file: null,
    fileOwner: null,
    loading: true,
    error: '',
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '文件预览' });
    const id = Number(options.id);
    if (!id) {
      this.setData({ loading: false, error: '缺少文件编号，请从党建学习列表进入。' });
      return;
    }
    this.setData({ id });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const study = await party.getStudy(this.data.id);
      this.setData({
        doc: {
          type: study.type,
          title: study.title,
          date: study.date,
          owner: study.department,
          paragraphs: study.paragraphs,
        },
        videos: study.videos,
        file: study.files[0] || null,
        fileOwner: study.fileOwner,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || '文件加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  /**
   * 打开主文件。**「在线预览」与「下载文件」都走这里**，见头注。
   *
   * `data-action` 只用来在失败时说清楚教师点的是哪个按钮，不用来选路径 ——
   * 两个按钮本来就是同一条路径。
   */
  async onOpenFile(e) {
    if (!this.data.file) return;
    const action = e.currentTarget.dataset.action;
    wx.showLoading({ title: '正在取档', mask: true });
    try {
      const r = await media.openFile(this.data.file.fileId, this.data.fileOwner);
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
      wx.showToast({ title: err.userMessage || `${action}失败，请稍后重试`, icon: 'none' });
    }
  },

  onCopyUrl(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.url,
      success: () => wx.showToast({ title: '链接已复制，请到浏览器打开', icon: 'none' }),
    });
  },
});
