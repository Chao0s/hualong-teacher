/**
 * 在园时光发布页 — APP-STRUCTURE.md screen id `GardenPublish`（票据 17）。
 *
 * 三个阶段，顺序不可跳，与 pages/task/submit.js 同一套：
 *
 *   edit     教师写名称、评语、挑照片、勾幼儿。此时只有草稿在动。
 *   preview  教师读**最终内容**（文字与处理后的图片）。读到底才算完整预览。
 *   done     已发布，内容锁定。s3 的正文、日期、图片与幼儿名单**永久唯读**（F16）。
 *
 * 完整预览与明确发布是**两个独立条件**：读到底只解锁「确认发布」这个按钮，按下它才是
 * 第二个动作。两者缺一，`utils/moderation` 在请求发出之前就拒绝。
 *
 * **本页只提供图片入口，一个视频入口也没有**（DO-NOT-BUILD 12）：`utils/media` 用的是
 * `wx.chooseImage`，它根本回不了视频；`wx.chooseMedia` 默认同时收视频，要靠一个参数把
 * 它关掉，参数写错就是一个视频入口。理由写在 utils/media.js 的头注里。
 *
 * **发布后教师端没有「审核中」状态**（D1／D2）：教师点发布，帖子立刻可见；图片的内容
 * 安全检查在服务端随后跑，不通过则自动撤回并通知教师。所以这一页一个「待审」字样也
 * 没有，`utils/moderation` 的 `IMAGE_MEDIA_CHECK_ASYNC` 分支会拦下任何这样的界面。
 *
 * 假期是**只读状态，不是错误**：页面照常打开，写入区换成一行理由。教师不该点进一个会
 * 当面拒绝他的按钮。
 */

const guard = require('../../../../utils/guard');
const coEdu = require('../../../../services/co-education');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * **两条，因为这一次写入携带两类内容**：
 *   HUMAN_PREVIEW_CONFIRM   教师写的文字 —— 完整预览＋明确发布，不送微信接口。
 *   IMAGE_MEDIA_CHECK_ASYNC 每一张上传图片 —— 服务端 mediaCheckAsync，先发后审。
 *
 * 只声明前一条而带了照片，图片那一类就没有声明，**等同未声明**，请求发不出去。
 */
const GATE_PATHS = [
  moderation.GATES.HUMAN_PREVIEW_CONFIRM,
  moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC,
];

Page({
  data: {
    ready: false,
    loading: true,

    className: '',
    children: [],

    momentId: 0,
    draft: null,
    limits: coEdu.MOMENT_LIMITS,
    imageLimit: coEdu.MOMENT_IMAGE_LIMIT,

    // 只读态：假期，或这一则已经发布。是状态，不是错误。
    readonly: false,
    readonlyReason: '',

    stage: 'edit',
    // 发布前置没满足的那几条，逐条点名。
    blockers: [],
    previewedInFull: false,
    confirmed: false,
    locked: false,
    preview: null,

    // 选照片时就地说的那句话（10 MB、张数上限）。不是一次服务故障。
    photoNotice: '',
    picking: false,
    // 缩略图（原型 `.photo-thumb`）。刚选的那几张用本机临时路径，不必先传完再看；
    // 从服务端读回来的草稿则逐张现签地址（§4 规则 1，没有可直接访问的地址）。
    photos: [],
    // 原型那块统计：已勾选几人、占全班几成。**不是自己数出来的口径** ——
    // 分子是草稿里勾了几个，分母是本班名册的人数，两者都在手上。
    coverage: { selected: 0, total: 0, rate: 0 },

    saving: false,
    submitting: false,
    // 一次逻辑发布的幂等键，生成一次、重发复用（§4.2）。
    attemptKeys: null,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    this.setData({
      ready: true,
      momentId: Number(query.moment_id) || 0,
      // 进度页点一格进来时带的周次。草稿的日期由教师挑，这里只把它记下来给页面显示，
      // **不由它反算日期** —— 周次到日期是服务端派生列的反方向，客户端算不得。
      weekKey: query.week_key || '',
    });
    this.applyTermState();
    // 返回 promise：平台忽略它，但测试要等它读完，不必靠 sleep 猜时机。
    return this.load(query);
  },

  /** 假期：页面照常打开，写入区换成一行理由（§5.4 / §6.4）。 */
  applyTermState() {
    if (guard.canWriteThisTerm()) return;
    this.setData({ readonly: true, readonlyReason: '假期中暂不可发布，新学期开始后恢复' });
  },

  async load(query) {
    try {
      const roster = await coEdu.classRoster();
      const draft = coEdu.emptyMomentDraft('');
      // 进度页带进来的那一名幼儿先勾上：教师点的就是他那一格。
      const childId = Number(query.child_id) || 0;
      if (childId) draft.child_id = [childId];
      this.setData({
        loading: false,
        className: roster.className,
        children: roster.children,
        draft,
      });
      // 名册读回来之后分母才知道，所以这一句排在 setData 之后。
      this.setData({ coverage: this.coverageOf(draft) });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load({});
  },

  // ── 表单 ──────────────────────────────────────────────────────────────────

  /** 勾了几个、占全班几成。整数百分比，不四舍五入到小数 —— 原型上就是整数。 */
  coverageOf(draft) {
    const total = (this.data.children || []).length;
    const selected = ((draft || {}).child_id || []).length;
    return { selected, total, rate: total ? Math.round((selected / total) * 100) : 0 };
  },

  onTextInput(e) {
    this.patchDraft(e.currentTarget.dataset.field, e.detail.value);
  },

  /** 日期滚轮。`moment_date` 是**裸日期**（§1.2 写入端只收 `YYYY-MM-DD`）。 */
  onDateChange(e) {
    this.patchDraft('moment_date', e.detail.value);
  },

  /** 幼儿勾选。组件回的是完整名单，不是增量 —— `child_id` 在契约上是整份替换。 */
  onChildrenChange(e) {
    this.patchDraft('child_id', e.detail.childIds);
  },

  /**
   * 改一个字段。**改动作废上一次的完整预览**：教师改完字不重看一遍，上一次的预览就
   * 不再是对这份内容的把关。
   */
  patchDraft(field, value) {
    if (this.data.readonly || this.data.locked) return;
    const draft = { ...this.data.draft, [field]: value };
    this.setData({
      draft,
      coverage: this.coverageOf(draft),
      blockers: [],
      previewedInFull: false,
      confirmed: false,
      preview: null,
      stage: 'edit',
    });
  },

  // ── 照片 ──────────────────────────────────────────────────────────────────

  /**
   * 选照片，**每张选完就地按 10 MB 上限校验并说明原因**（票据 17 验收项 3）。
   *
   * 顺序是有意的：先问张数够不够，再逐张问大小，最后才上传。让教师等一趟上传才知道
   * 照片太大，是把一个本机就答得出的问题送去问服务器。
   */
  async onPickPhotos() {
    if (this.data.readonly || this.data.picking || this.data.locked) return;
    const already = (this.data.draft.file_id || []).length;
    const room = coEdu.MOMENT_IMAGE_LIMIT - already;
    if (room <= 0) {
      this.setData({ photoNotice: `一则在园时光最多 ${coEdu.MOMENT_IMAGE_LIMIT} 张照片，已经选满了。` });
      return;
    }

    let picked;
    try {
      picked = await coEdu.pickImages(room);
    } catch (err) {
      this.setData({ photoNotice: err.message });
      return;
    }
    if (!picked.length) return;      // 教师取消了。取消不是失败，不说话。

    // 超限的那几张就地点名，**说出它多大**，而不是一句「有照片太大」。
    const tooBig = picked.filter((p) => coEdu.tooLarge(p.size));
    if (tooBig.length) {
      this.setData({ photoNotice: coEdu.tooLargeReason(tooBig[0]) });
      return;
    }

    this.setData({ picking: true, photoNotice: '' });
    try {
      const ids = [];
      for (let i = 0; i < picked.length; i += 1) {
        // 逐张走，不并发：并发失败时哪几张落了库说不清楚，而重试要能接着上一张。
        // eslint-disable-next-line no-await-in-loop
        ids.push(await coEdu.uploadPickedFile(picked[i], coEdu.MOMENT_USAGE_KEY));
      }
      this.setData({ picking: false });
      this.patchDraft('file_id', (this.data.draft.file_id || []).concat(ids));
      // 本机路径直接当缩略图：这几张就在手机上，没必要绕一趟签名。
      this.setData({
        photos: this.data.photos.concat(ids.map((id, i) => ({ file_id: id, url: picked[i].path }))),
      });
    } catch (err) {
      reportFailure(this, err, { picking: false });
    }
  },

  onRemovePhoto(e) {
    const fileId = Number(e.currentTarget.dataset.fileId);
    this.patchDraft('file_id', (this.data.draft.file_id || []).filter((id) => id !== fileId));
    this.setData({
      photoNotice: '',
      photos: this.data.photos.filter((p) => p.file_id !== fileId),
    });
  },

  /** 点开一张缩略图看大图。地址已经在手上，这一步不跑网络。 */
  onPhotoTap(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.photos.map((p) => p.url);
    if (!urls.length) return;
    wx.previewImage({ urls, current: urls[index] });
  },

  // ── 预览与发布 ────────────────────────────────────────────────────────────

  /**
   * 进入预览。把草稿**冻结**成最终内容，之后发布的就是这一份。
   *
   * 发布前置在这里问，**缺项时一个请求也不发**：草稿允许不完整（契约明写），完整性
   * 只在发布时验，所以这里是客户端唯一该问的那一次。
   */
  onPreviewTap() {
    if (this.data.readonly || this.data.locked) return;
    const blockers = coEdu.momentBlockers(this.data.draft);
    if (blockers.length) {
      this.setData({ blockers, errorText: '', errorRequestId: '', errorCanRetry: false });
      return;
    }
    const draft = { ...this.data.draft, child_id: (this.data.draft.child_id || []).slice() };
    const names = this.data.children
      .filter((c) => draft.child_id.indexOf(c.child_id) !== -1)
      .map((c) => c.child_name);
    this.setData({
      stage: 'preview',
      blockers: [],
      previewedInFull: false,
      confirmed: false,
      preview: {
        draft,
        // 教师在预览里看到的，与将要发出的请求体，来自同一次构造。
        body: coEdu.buildMomentBody(draft),
        childNames: names.join('、'),
        photoCount: (draft.file_id || []).length,
      },
    });
  },

  /**
   * 预览滚到底。这是「完整预览」的落点 —— 打开预览不算，读到最后一行才算。
   * 内容短到不需要滚动时，`bindscrolltolower` 在渲染后立即触发，语义一致。
   */
  onPreviewEnd() {
    if (this.data.stage !== 'preview') return;
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    if (this.data.locked) return;
    this.setData({ stage: 'edit', previewedInFull: false, confirmed: false, preview: null });
  },

  /**
   * 明确发布 —— 第二个独立动作。
   *
   * 两个端点，一次逻辑尝试：先建草稿（NONE -> s1），再发布（s1 -> s3）。幂等键在这里
   * 生成一次并留在页面上，重复点击复用同一对，服务端按 §4.2 原样回第一次的状态码与
   * 响应体，因此**只产生一则在园时光**。它**不**在每次点击时新建。
   *
   * 请求体里没有 `teacher_id`、没有 `published_at`、没有 `week_key` —— 三者都由服务端
   * 设值或派生，客户端在 `buildMomentBody` 里就没造它们（DO-NOT-BUILD 8）。
   */
  async onConfirmTap() {
    if (this.data.readonly || this.data.submitting || this.data.locked) return;

    const attemptKeys = this.data.attemptKeys || coEdu.newMomentKeys();
    // 内容在确认的这一刻锁定，先于网络往返：等回包再锁，中间那段时间还改得动。
    this.setData({
      submitting: true,
      confirmed: true,
      locked: true,
      attemptKeys,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });

    const draft = this.data.preview ? this.data.preview.draft : null;
    try {
      let momentId = this.data.momentId;
      if (!momentId) {
        const created = await coEdu.createMomentDraft({
          gates: GATE_PATHS,
          draft,
          previewedInFull: this.data.previewedInFull,
          confirmed: true,
          idempotencyKey: attemptKeys.create,
        });
        momentId = created.moment_id;
        this.setData({ momentId });
      } else {
        await coEdu.saveMomentDraft({
          gates: GATE_PATHS,
          momentId,
          draft,
          previewedInFull: this.data.previewedInFull,
          confirmed: true,
        });
      }

      await coEdu.publishMoment({
        gates: GATE_PATHS,
        momentId,
        draft,
        previewedInFull: this.data.previewedInFull,
        confirmed: true,
        idempotencyKey: attemptKeys.publish,
      });

      this.setData({
        submitting: false,
        stage: 'done',
        readonly: true,
        // 已发布，不是待审 —— 教师端没有「审核中」中间态（D1／D2）。
        readonlyReason: '已发布，家长现在就看得到。发布后内容不能再改。',
      });
    } catch (err) {
      // 内容解锁，否则教师改不了缺的那一步。
      this.setData({ locked: false, confirmed: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。把闸门
        // 自己的话原样给教师 —— 兜底文案不告诉他缺了哪一步。
        this.setData({
          submitting: false, errorText: err.message, errorRequestId: '', errorCanRetry: false,
        });
        return;
      }
      reportFailure(this, err, { submitting: false });
    }
  },

  onBackTap() {
    wx.navigateBack();
  },
});
