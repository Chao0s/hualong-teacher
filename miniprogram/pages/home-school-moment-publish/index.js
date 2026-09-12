/**
 * 发布活动 —— 写入 `POST /moments`，一次提交即发布。
 *
 * 幼儿名单来自 `services/co-education.classRoster()`，是本班真实在园幼儿。
 *
 * ── 没有草稿，发布前确认一次 ───────────────────────────────────────────────
 *
 * 服务端不存草稿（契约 v0.7）。教师填完点发布，**先弹一次确认**：`wx.showModal`
 * 把标题与涉及人数摆出来，让人在内容发出去之前重看一眼，确认后才发请求。
 *
 * **用 `wx.showModal` 而不是同按钮二次点击。** 规格里那条「不调用宿主可能拦截的
 * 原生 confirm」针对的是网页的 `window.confirm`；小程序的 `wx.showModal` 是平台
 * API，不会被宿主拦掉。
 *
 * 中途退出内容不保留。前端若要自行暂存，那是客户端行为，不属服务端契约。
 *
 * ── 三件事按契约做，都不是这一页发明的 ─────────────────────────────────────
 *
 * 1. **`child_id` 与 `file_id` 是整份替换**，不是增量：本次未列出的幼儿，其
 *    `db_moment_upload` 行会被删除。所以每次保存都送完整集合。
 *
 * 2. **`moment_date` 必须落在当前学期且不晚于园所今天**。默认值由
 *    刷新会话取得的school_today决定，不用设备日期冒充测试后端的今天。
 *
 * 3. **照片选完当场就传**。`file_id` 收的是**已经落库的** id，所以列表里只放
 *    传成功的那几张：一个看着像已上传、实际什么都没发生的条目，比少一张糟得多。
 *    传失败的不进列表，页面说明失败了几张。
 *
 * DO-NOT-BUILD 12：**不出现视频入口**。`chooseMedia` 因此锁死 `mediaType: ['image']`，
 * 不要加 `'video'`。理由是 `wx.uploadFile` 单次 10 MB 硬上限使手机视频根本发不出去，
 * 三条出路未拍板。
 */

const co = require('../../services/co-education');
const media = require('../../services/media');
const guard = require('../../utils/guard');
const auth = require('../../utils/auth');

Page({
  data: {
    title: '',
    content: '',
    date: '',
    photos: [],

    children: [],
    selectedCount: 0,
    rate: 0,

    loading: true,
    error: '',
    publishing: false,
    canWrite: true,
  },

  async onLoad() {
    try {
      // 假期中没有进行中的学期：契约 §6.4 允许客户端预先禁用写入，服务端仍会
      // 独立回 409 no_active_term。这是礼貌，不是关卡。
      const date = await this.publicationDate();
      if (!date) {
        this.setData({
          loading: false,
          canWrite: false,
          error: '现在是假期，没有进行中的学期。新学期开始后即可发布。',
        });
        return;
      }
      const roster = await co.classRoster();
      this.setData({
        date,
        // 集体活动默认全员参与，教师取消缺席的那几个。
        children: roster.map((c) => ({ childId: c.childId, name: c.name, checked: true })),
        loading: false,
      });
      this.syncSelected();
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        error: err.userMessage || err.message || '名单加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.setData({loading: true, error: '', canWrite: true});
    this.onLoad();
  },

  async publicationDate() {
    await guard.requireSession();
    const context = await auth.refreshContext();
    if (!context.current_term) return '';
    if (typeof context.school_today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(context.school_today)) {
      throw new Error('无法取得园所日期，请刷新后重试');
    }
    return co.defaultMomentDate(Date.now(), context.school_today);
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onToggleChild(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ [`children[${i}].checked`]: !this.data.children[i].checked });
    this.syncSelected();
  },

  syncSelected() {
    const total = this.data.children.length;
    const selectedCount = this.data.children.filter((c) => c.checked).length;
    this.setData({
      selectedCount,
      rate: total ? Math.round((selectedCount / total) * 100) : 0,
    });
  },

  selectedChildIds() {
    return this.data.children.filter((c) => c.checked).map((c) => c.childId);
  },

  /**
   * 选照片。`count` 只给**还能放下的张数**，超过 9 张服务端回 422
   * `moment_image_limit`，在选择器上先挡住比事后报错好。
   */
  onAddPhoto() {
    const remain = co.MAX_PHOTOS - this.data.photos.length;
    if (remain <= 0) {
      wx.showToast({ title: `照片最多 ${co.MAX_PHOTOS} 张`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      // DO-NOT-BUILD 12：只收图片，不要加 'video'。
      mediaType: ['image'],
      success: (res) => this.uploadPhotos(res.tempFiles || []),
    });
  },

  /**
   * 逐张传，传成一张进一张。
   *
   * **一张一张地传，不并发**：单张上限 10 MB，手机上同时发九发只会更慢，而且
   * 一发失败就分不清是哪一张。这一层慢一点换来的是「传成的进列表、传砸的不进」
   * 这个能说清楚的结果。
   *
   * 失败不中断其余的：九张里有一张超限，另外八张照样该进列表。最后报一句
   * 「N 张没能上传」，理由取最后那一次的服务端文案。
   */
  async uploadPhotos(picked) {
    wx.showLoading({ title: '正在上传照片', mask: true });
    const added = [];
    let failed = 0;
    let reason = '';
    for (let i = 0; i < picked.length; i += 1) {
      try {
        await guard.requireSession();
        const file = await media.uploadFile(picked[i].tempFilePath, {
          usageKey: media.USAGE.IMAGE,
          byteSize: picked[i].size,
        });
        added.push({
          fileId: file.fileId,
          label: `照片 ${this.data.photos.length + added.length + 1}`,
          previewUrl: picked[i].tempFilePath,
        });
      } catch (err) {
        if (guard.endSessionOnAuthFailure(err)) {
          wx.hideLoading();
          return;
        }
        failed += 1;
        reason = err.userMessage || '';
      }
    }
    wx.hideLoading();
    this.setData({ photos: this.data.photos.concat(added) });
    if (failed) {
      wx.showToast({ title: `${failed} 张没能上传${reason ? `：${reason}` : ''}`, icon: 'none' });
    }
  },

  async onPublish() {
    if (this.data.publishing || !this.data.canWrite) return;

    const childIds = this.selectedChildIds();
    const fileIds = this.data.photos.map((p) => p.fileId);

    // 本地预检：让教师在点下去之前知道缺什么。服务端发布时独立再验一次。
    const missing = co.whyCannotPublish({
      title: this.data.title,
      content: this.data.content,
      childIds,
      fileIds,
    });
    if (missing) {
      wx.showToast({ title: missing, icon: 'none' });
      return;
    }

    // 发布前确认。**这一步取代了草稿** —— 内容一旦发出去，家长立刻看得到，
    // 而且发布后正文、日期、图片与幼儿名单永久唯读（F16），改不了只能删掉重发。
    // 所以把要发的东西摆出来让人重看一眼，比事后补救便宜。
    this.setData({ publishing: true });
    wx.showLoading({ title: '正在核对发布信息', mask: true });
    let published = false;
    try {
      const date = await this.publicationDate();
      if (!date) throw new Error('当前没有进行中的学期，暂不能发布活动');
      this.setData({date});
      wx.hideLoading();
      const confirmed = await this.confirmPublish(childIds.length);
      if (!confirmed) return;
      wx.showLoading({ title: '正在发布', mask: true });
      await co.publish({
        title: this.data.title,
        content: this.data.content,
        date,
        childIds,
        fileIds,
      });
      published = true;
      wx.hideLoading();
      wx.showToast({ title: '已发布', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({
        title: co.momentPublishFailureText(err),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      if (!published) this.setData({publishing: false});
    }
  },

  /** 确认弹窗。resolve(true) 才继续发。 */
  confirmPublish(childCount) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认发送？',
        content: `《${this.data.title.trim()}》，涉及 ${childCount} 名幼儿。\n发送后家长即可看到，内容不能修改，只能删除重发。`,
        confirmText: '确认发送',
        cancelText: '再看看',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
  },
});
