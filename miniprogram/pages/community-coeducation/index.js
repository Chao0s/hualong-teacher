/**
 * 社区共育 —— 家长投稿的 feed。
 *
 * 数据全部来自 `GET /home-school/community-feed`，经 `services/co-education.js`
 * 的 `listCommunityFeed()`。页面不拼 URL、不译枚举、不格式化时间。
 *
 * ── 一张卡片是一笔家长投稿 ─────────────────────────────────────────────────
 *
 * 社区共育不是独立实体，是亲子任务与家长提交的 feed 视图（B11）。一条任务对 N 笔
 * 投稿，所以卡片的主体是**家长写的正文与家长拍的照片**，任务标题只是卡片脚上的出处。
 *
 * 服务端固定只回已提交的那些。**「谁还没交」不在这一页**，在亲子任务详情的完成情况
 * 看板上 —— 两页口径刻意不同。
 *
 * ── 两个筛选都不在本地做 ───────────────────────────────────────────────────
 *
 * 时间与任务类别都发给服务端，重新取一页。时间窗的边界由服务端按园所时区算，
 * **这一页一个日期都不推**（契约原话：前端不得自行推日期）。
 * 两个「全部」表示不发该参数，不是发一个 `all` 字符串。
 *
 * ── 「加入成长册」写的是教师分支 ───────────────────────────────────────────
 *
 * `PUT /teacher/growth-book/task-submissions/{id}/inclusion`。教师这一支与家长那一支
 * **各自独立**（F17）：收进来不影响家长的选择，移出也不删原提交与照片。
 * 照抄原型的交互：点一下把该条全部照片收进去，再点一下整条移出，没有选照片的浮层。
 *
 * ── 照片地址逐张取 ─────────────────────────────────────────────────────────
 *
 * 列表只回 `file_id`，不回地址。地址走 `photoUrl()` 每次重验、5 分钟签名（§8.4），
 * 所以不能缓存进列表数据当长期可用。格子数先按 file_id 铺好，地址随后逐张填上，
 * 图片陆续到达时布局不跳。
 */

const co = require('../../services/co-education');

/** 卡片上最多铺几格。其余用角标表示，与在园时光 feed 同一个口径。 */
const PREVIEW_PHOTOS = 3;

/** 头像底色，按幼儿姓名散列。原型里是写死的四种，这里按第一个字取，稳定且不用存。 */
const TONES = ['', 'green', 'amber', 'blue'];

function toneOf(name) {
  let n = 0;
  for (const ch of String(name || '')) n = (n + ch.charCodeAt(0)) % TONES.length;
  return TONES[n];
}

Page({
  data: {
    // key 就是发给服务端的值；`all` 表示不发这个参数。
    timeOptions: [
      { key: 'all', label: '全部时间' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'earlier', label: '更早' },
    ],
    timeIndex: 0,
    typeOptions: [
      { key: 'all', label: '全部任务' },
      { key: 't1', label: '日常任务' },
      { key: 't2', label: '社区任务' },
    ],
    typeIndex: 0,
    visible: [],
    loading: true,
    failed: '',
  },

  onShow() {
    this.refresh();
  },

  onTimeChange(e) {
    this.setData({ timeIndex: Number(e.detail.value) });
    this.refresh();
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
    this.refresh();
  },

  async refresh() {
    const seq = (this.loadSeq || 0) + 1;
    this.loadSeq = seq;
    const timeKey = this.data.timeOptions[this.data.timeIndex].key;
    const typeKey = this.data.typeOptions[this.data.typeIndex].key;

    this.setData({ loading: true, failed: '' });
    try {
      // 缺席＝不加这条筛选。`all` 是页面自己的标记，不发给服务端。
      const page = await co.listCommunityFeed({
        type: typeKey === 'all' ? undefined : typeKey,
        timeWindow: timeKey === 'all' ? undefined : timeKey,
        limit: 100,
      });
      if (seq !== this.loadSeq) return;
      const visible = page.items.map((row) => ({
        id: row.id,
        initial: row.initial,
        tone: toneOf(row.author),
        author: row.author,
        time: row.submittedLabel,
        text: row.text,
        underCheck: row.underCheck,
        typeLabel: row.typeLabel,
        taskTitle: row.taskTitle,
        // 格子先按 file_id 铺好，地址随后填。
        photos: row.fileIds.slice(0, PREVIEW_PHOTOS).map((fid) => ({ fileId: fid, url: '' })),
        moreCount: Math.max(0, row.fileIds.length - PREVIEW_PHOTOS),
        photoCount: row.fileIds.length,
        fileIds: row.fileIds,
        // 取照片地址要交上去的宿主那一对（授权参数）。service 给的，页面不拼。
        photoOwner: row.photoOwner,
        included: row.included,
      }));
      this.setData({ visible, loading: false });
      this.fillPhotos(visible);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      this.setData({ visible: [], loading: false, failed: err.userMessage || '社区共育加载失败，请稍后重试' });
    }
  },

  /** 逐张换地址，回来一张填一张。列表可能已经换过筛选，所以按 id 找回位置。 */
  fillPhotos(items) {
    items.forEach((post) => {
      post.photos.forEach(async (photo, i) => {
        const url = await co.photoUrl(photo.fileId, post.photoOwner);
        if (!url) return;
        const at = this.data.visible.findIndex((x) => x.id === post.id);
        if (at < 0) return;
        this.setData({ [`visible[${at}].photos[${i}].url`]: url });
      });
    });
  },

  /** 每张缩略图从所点照片打开；+N从第4张开始。每次重取短链，保持照片ID对应。 */
  async onPreviewPhotos(e) {
    if (this.previewing) return;
    const id = Number(e.currentTarget.dataset.id);
    const post = this.data.visible.find((x) => x.id === id);
    if (!post || post.underCheck || !post.fileIds.length) return;
    const selectedId = e.currentTarget.dataset.fileId === undefined
      ? post.fileIds[Math.min(PREVIEW_PHOTOS, post.fileIds.length - 1)]
      : Number(e.currentTarget.dataset.fileId);
    if (!post.fileIds.includes(selectedId)) return;
    this.previewing = true;
    wx.showLoading({ title: '正在打开照片', mask: true });
    try {
      const photos = await Promise.all(post.fileIds.map(async (fileId) => ({
        fileId, url: await co.photoUrl(fileId, post.photoOwner),
      })));
      // 筛选后该投稿已离开列表时，不再弹出旧投稿的预览。
      if (!this.data.visible.some((row) => row.id === id)) return;
      const selected = photos.find((photo) => photo.fileId === selectedId);
      if (!selected || !selected.url) {
        wx.showToast({ title: '这张照片暂时打不开，请稍后重试', icon: 'none' });
        return;
      }
      wx.hideLoading();
      wx.previewImage({
        urls: photos.filter((photo) => photo.url).map((photo) => photo.url),
        current: selected.url,
        fail: () => wx.showToast({ title: '照片预览失败，请重试', icon: 'none' }),
      });
    } catch (err) {
      wx.showToast({ title: (err && err.userMessage) || '照片暂时打不开，请稍后重试', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.previewing = false;
    }
  },

  /**
   * 收进成长册，或整条移出。
   *
   * 收进去时把**该条全部照片**交上去（不只是卡片上铺出来那三张），照抄原型。
   * 服务端复验 file_id 是该笔提交已冻结附件的子集。
   */
  async onToggleMaterial(e) {
    const id = Number(e.currentTarget.dataset.id);
    const post = this.data.visible.find((row) => row.id === id);
    if (!post || post.underCheck || this.inclusionBusy) return;

    const next = !post.included;
    this.inclusionBusy = true;
    try {
      await co.setBookInclusion(post.id, {
        included: next,
        fileIds: next ? [...new Set(post.fileIds)] : [],
      });
      // 操作完成后重读同一筛选的真实状态，避免旧列表把成功状态覆盖。
      await this.refresh();
      wx.showToast({ title: next ? '已加入成长册' : '已移出成长册', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: co.bookInclusionFailureText(err), icon: 'none' });
    } finally {
      this.inclusionBusy = false;
    }
  },
});
