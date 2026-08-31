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
 * 2. **「PDF · 2.4MB」删掉了。** 那是写死在模板里的一串字，`db_file` 上确实有
 *    大小与类型，但契约的 `PartyStudy.file_refs` 只回 `{file_id, usage_key}`，
 *    取不到。与其显示一个对每份文件都不对的常数，不如不显示。
 *
 * 3. **视频可能一条也没有。** `video_links` 是可空列（三份材料里就有一份是 null），
 *    没有视频时整块不渲染，而不是画一个空的「相关视频学习」标题。
 *
 * 「在线预览 / 下载文件」在原型里就是弹提示。契约里党建学习**没有取档端点**
 * （资源与案例那边有 `/download-link`，这一族没有），所以它仍然只能说明情况——
 * 但说的是「还没有取档接口」，不是原型那句含糊的「示例反馈」。
 */

const party = require('../../services/party');
const guard = require('../../utils/guard');

Page({
  data: {
    id: null,
    doc: null,
    videos: [],
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
   * 契约的 party 族没有取档端点。说清楚是「接口还没有」，不是「点了没反应」。
   */
  onAction(e) {
    wx.showToast({
      title: `${e.currentTarget.dataset.action}：党建文件的取档接口尚未开放`,
      icon: 'none',
    });
  },

  onCopyUrl(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.url,
      success: () => wx.showToast({ title: '链接已复制，请到浏览器打开', icon: 'none' }),
    });
  },
});
