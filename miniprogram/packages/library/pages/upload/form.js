/**
 * 上传资源与案例 —— 一张表单，两个入口，一条写入路径（票据 15）。
 *
 * 待办事项与案例库都进这一页，`services/library.js` 的 `openUpload` 是它们唯一的门。
 * 「两个入口发出的请求完全一致」因此不是两处写法互相看齐的结果 —— 这一页只有一份表单
 * 逻辑，也只有一条写入路径。入口带进来的只有两样：填哪一张表（`target`），改哪一条
 * （`content_id`）。
 *
 * 提交是**两个端点**：先建草稿（NONE -> s1），再提交审核（s1 -> s2）。契约就是这样切的，
 * 客户端不合并成一次。已经存在的草稿则是先 PATCH 再提交。两次调用同属一次逻辑尝试，
 * 所以它们的幂等键在按下提交的那一刻生成一次、重发复用（§4.2）。
 *
 * **提交后是「待审核」，不是「已发布」。** 资源与案例走 ADR-0016 第 4 行 / F6 的管理端
 * 人工审核队列，与任务材料那一票的「完整预览＋明确发布」是两条不同的路径 —— 那一票发布
 * 即可见，这一票要等人看过。`utils/moderation` 的 `ADMIN_REVIEW_QUEUE` 分支会拦下任何
 * 把它说成已发布的界面。
 *
 * 没有视频入口，一个也没有（DO-NOT-BUILD 12）。封面只从 `wx.chooseImage` 来，理由写在
 * services/library.js 的 `pickCoverImage` 头注里。
 */

const guard = require('../../../../utils/guard');
const library = require('../../../../services/library');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 * 两条，因为一次写入可能同时携带两类内容：
 *   ADMIN_REVIEW_QUEUE      资源与案例本身 —— ADR-0016 第 4 行 / F6 的管理端人工审核。
 *                           Word 详案不是图片，随这一条内容一起走这条路径。
 *   IMAGE_MEDIA_CHECK_ASYNC 封面图片 —— ADR-0016 第 2 行：**所有上传图片（含教职工）**
 *                           走服务端 mediaCheckAsync，先发后审。
 *
 * 两条都常在，`assertGate` 再按本次的 `imageCount` 检查覆盖够不够 —— 只声明前一条而带了
 * 封面，图片这一类就没有声明，等同未声明，请求发不出去。
 */
const GATE_PATHS = [
  moderation.GATES.ADMIN_REVIEW_QUEUE,
  moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC,
];

/** 只有草稿（s1）与还没建立的新内容可以编辑。F6：pending 之后内容冻结。 */
const EDITABLE_STATUS = ['', 's1'];

Page({
  data: {
    ready: false,
    loading: false,

    target: 'resource',
    targets: library.UPLOAD_TARGETS,
    // 上传人只读回显。§6.4：scope 只作显示用 —— 显示，不是提交。
    uploader: library.uploaderIdentity(),
    options: {},
    limits: library.LIMITS,
    // 「关联资源」滚轮的取值，只有案例表单要，所以只在案例表单打开时读。
    resourceOptions: [],
    resourcePicked: [],

    contentId: 0,
    status: '',
    statusLabel: '',
    statusPill: '',
    decisionReason: '',

    // 只读态：假期，或这一条不在草稿里。是状态，不是错误。
    readonly: false,
    readonlyReason: '',

    draft: {},
    // 缺项与超长就地标出，缺项时根本不发请求。
    missing: [],
    tooLong: [],

    uploading: '',
    fileNotice: '',

    submitting: false,
    withdrawing: false,
    // 一次逻辑提交的幂等键，生成一次、重发复用（§4.2）。
    attemptKeys: null,
    submitted: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad(query) {
    if (!guard.requireSession()) return;
    const target = query.target === 'case' ? 'case' : 'resource';
    const contentId = Number(query.content_id) || 0;
    this.setData({
      ready: true,
      target,
      options: library.uploadOptions(),
      draft: library.emptyDraft(target),
    });
    this.applyTermState();
    if (contentId) this.load(target, contentId);
    else if (target === 'case') this.loadResourceOptions();
  },

  /**
   * 假期是一种状态，不是一个错误：页面照常打开，写入区换成一行理由。
   * 教师不该点进一个会当面拒绝他的按钮（§5.4 / §6.4）。
   */
  applyTermState() {
    if (guard.canWriteThisTerm()) return;
    this.setData({ readonly: true, readonlyReason: '假期中暂不可提交，新学期开始后恢复' });
  },

  async load(target, contentId) {
    this.setData({ loading: true, contentId });
    try {
      const row = await library.loadForEdit(target, contentId);
      this.setData({
        loading: false,
        contentId: row.contentId,
        status: row.status,
        statusLabel: row.statusLabel,
        statusPill: row.statusPill,
        decisionReason: row.decisionReason,
        draft: row.draft,
      });
      this.applyStatusLock(row.status);
      if (target === 'case') await this.loadResourceOptions();
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /** 不在草稿里的内容不能改。这是 F6 的内容冻结，说出来，不做成一个会拒绝人的输入框。 */
  applyStatusLock(status) {
    if (this.data.readonly) return;       // 假期那条理由更靠前，别覆盖它
    if (EDITABLE_STATUS.indexOf(status) !== -1) return;
    const reason = status === 's2' ? '这一条正在审核中，内容已冻结。撤回到草稿后可以修改。'
      : status === 's4' ? '这一条被驳回了。撤回到草稿后可以修改，改完重新提交。'
        : status === 's3' ? '这一条已经发布。撤回到草稿会立刻停止新的查看与下载。'
          : '这一条已下架，不能再修改。';
    this.setData({ readonly: true, readonlyReason: reason });
  },

  async loadResourceOptions() {
    try {
      this.setData({ resourceOptions: await library.resourcePickerOptions() });
      this.syncResourcePicked();
    } catch (err) {
      // 关联资源是选填的。读不到取值时表单照常能提交，只是这一行没得选。
      this.setData({ resourceOptions: [] });
    }
  },

  onRetryLoad() {
    if (!this.data.contentId) return;
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load(this.data.target, this.data.contentId);
  },

  // ── 表单 ──────────────────────────────────────────────────────────────────

  /**
   * 换一张表。**新建时才让换**：已经存在的那一条属于哪张表是服务端定的，
   * 在客户端改成另一张，下一次 PATCH 会打到一个不存在的地方。
   */
  onTargetTap(e) {
    const { key } = e.currentTarget.dataset;
    if (this.data.contentId || this.data.readonly) return;
    if (key === this.data.target) return;
    this.setData({
      target: key,
      draft: library.emptyDraft(key),
      missing: [],
      tooLong: [],
      resourcePicked: [],
      fileNotice: '',
    });
    if (key === 'case') this.loadResourceOptions();
  },

  onTextInput(e) {
    const { field } = e.currentTarget.dataset;
    this.patchDraft(field, e.detail.value);
  },

  /** 单选标签。再点一次不取消：必填项取消了只会变成一个缺项。 */
  onChipTap(e) {
    const { field, key } = e.currentTarget.dataset;
    this.patchDraft(field, key);
  },

  /** 多选标签。点一次进，再点一次出。 */
  onChipMultiTap(e) {
    const { field, key } = e.currentTarget.dataset;
    const current = this.data.draft[field] || [];
    const next = current.indexOf(key) === -1
      ? current.concat([key])
      : current.filter((k) => k !== key);
    this.patchDraft(field, next);
  },

  /** 滚轮确认。组件只在确认时触发，滑动与取消都不到这里（form-control-spec.md §4）。 */
  onResourcePick(e) {
    const { key } = e.detail;
    const id = Number(key);
    const current = this.data.draft.resource_ids || [];
    if (current.indexOf(id) !== -1) return;
    this.patchDraft('resource_ids', current.concat([id]));
    this.syncResourcePicked();
  },

  onResourceRemove(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.patchDraft('resource_ids', (this.data.draft.resource_ids || []).filter((r) => r !== id));
    this.syncResourcePicked();
  },

  /** 已选的关联资源，摊平成可以直接绑的标签。 */
  syncResourcePicked() {
    const options = this.data.resourceOptions;
    this.setData({
      resourcePicked: (this.data.draft.resource_ids || []).map((id) => {
        const hit = options.find((o) => o.key === String(id));
        return { id, label: hit ? hit.label : `资源 ${id}` };
      }),
    });
  },

  /**
   * 改一个字段。**改动会清掉这个字段的缺项标记**：教师填上之后那个红字还留在原地，
   * 会让他以为没填进去。超长的判定则重算全表，因为它只看当前值。
   */
  patchDraft(field, value) {
    if (this.data.readonly || this.data.submitted) return;
    const draft = { ...this.data.draft, [field]: value };
    this.setData({
      draft,
      missing: this.data.missing.filter((m) => m.key !== field),
      tooLong: library.tooLong(this.data.target, draft),
    });
  },

  // ── 封面与详案 ────────────────────────────────────────────────────────────

  onPickCover() {
    return this.pickAndUpload('cover_file_id', library.pickCoverImage, 'content_cover');
  },

  onPickWord() {
    return this.pickAndUpload('word_file_id', library.pickWordFile, 'content_word');
  },

  onClearFile(e) {
    this.patchDraft(e.currentTarget.dataset.field, null);
    this.setData({ fileNotice: '' });
  },

  /**
   * 选文件、当场校验大小、直传、落库。
   *
   * **10 MB 的判定在选完的那一刻**，在任何请求发出之前（票据 15 验收项 3）。让教师等一趟
   * 上传才知道文件太大，是把一个本机就答得出的问题送去问服务器。
   */
  async pickAndUpload(field, pick, usageKey) {
    if (this.data.readonly || this.data.uploading || this.data.submitted) return;
    let picked;
    try {
      picked = await pick();
    } catch (err) {
      this.setData({ fileNotice: err.message });
      return;
    }
    if (!picked) return;               // 教师取消了。取消不是失败，不说话。

    if (library.tooLarge(picked.size)) {
      this.setData({ fileNotice: library.tooLargeReason(picked) });
      return;
    }

    this.setData({ uploading: field, fileNotice: '' });
    try {
      const fileId = await library.uploadPickedFile(picked, usageKey);
      this.setData({ uploading: '' });
      this.patchDraft(field, fileId);
    } catch (err) {
      this.setData({ uploading: '' });
      reportFailure(this, err, {});
    }
  },

  // ── 提交 ──────────────────────────────────────────────────────────────────

  /**
   * 提交审核。
   *
   * 顺序是有意的：先在本机把缺项与超长都问完，**缺项时一个请求也不发**；再让
   * `utils/moderation` 在网络出口之前断言把关路径；最后才是两次真正的调用。
   */
  async onSubmitTap() {
    if (this.data.readonly || this.data.submitting || this.data.submitted) return;

    const missing = library.missingFields(this.data.target, this.data.draft);
    const tooLong = library.tooLong(this.data.target, this.data.draft);
    if (missing.length || tooLong.length) {
      this.setData({ missing, tooLong, errorText: '', errorRequestId: '', errorCanRetry: false });
      return;
    }

    // 幂等键在这里生成一次并留在页面上：重复点击复用同一对，服务端按 §4.2 原样回第一次的
    // 状态码与响应体，因此只有一条待审核记录。它**不**在每次点击时新建。
    const attemptKeys = this.data.attemptKeys || library.newAttemptKeys();
    this.setData({
      submitting: true, attemptKeys, missing: [], tooLong: [],
      errorText: '', errorRequestId: '', errorCanRetry: false,
    });

    try {
      let contentId = this.data.contentId;
      if (contentId) {
        await library.updateDraft({
          target: this.data.target,
          gates: GATE_PATHS,
          contentId,
          draft: this.data.draft,
        });
      } else {
        const created = await library.createDraft({
          target: this.data.target,
          gates: GATE_PATHS,
          draft: this.data.draft,
          idempotencyKey: attemptKeys.create,
        });
        contentId = created[this.data.target === 'case' ? 'case_id' : 'resource_id'];
        this.setData({ contentId });
      }

      await library.submitForReview({
        target: this.data.target,
        contentId,
        idempotencyKey: attemptKeys.submit,
      });

      this.setData({
        submitting: false,
        submitted: true,
        status: 's2',
        // 「待审核」这四个字由 utils/moderation 给，所有走同一条把关路径的界面因此说同一句话。
        statusLabel: moderation.pendingLabel(moderation.GATES.ADMIN_REVIEW_QUEUE),
        statusPill: 'hl-pill--pending',
        decisionReason: '',
        readonly: true,
        readonlyReason: '已提交审核，内容已冻结。撤回到草稿后可以修改。',
      });
    } catch (err) {
      this.setData({ submitting: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        this.setData({ errorText: err.message, errorRequestId: '', errorCanRetry: false });
        return;
      }
      reportFailure(this, err, {});
    }
  },

  /**
   * 撤回到草稿（s2｜s3｜s4 -> s1）。
   *
   * 被驳回之后回到表单的那一步就是它。**这不是「下架」**：作者撤回的目标是 s1，回到自己
   * 手里；强制下架的目标是 s5，只有管理端做得到（契约 §10.1）。
   */
  async onWithdrawTap() {
    if (this.data.withdrawing || !this.data.contentId) return;
    if (['s2', 's3', 's4'].indexOf(this.data.status) === -1) return;

    const attemptKeys = this.data.attemptKeys || library.newAttemptKeys();
    this.setData({ withdrawing: true, attemptKeys, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      await library.withdrawToDraft({
        target: this.data.target,
        contentId: this.data.contentId,
        idempotencyKey: attemptKeys.withdraw,
      });
      // 回到草稿意味着下一次提交是新的一次逻辑尝试，所以那一对键要作废。
      this.setData({
        withdrawing: false,
        status: 's1',
        statusLabel: library.CONTENT_STATUS.s1,
        statusPill: 'hl-pill--info',
        decisionReason: '',
        submitted: false,
        attemptKeys: null,
      });
      this.applyTermStateAfterWithdraw();
    } catch (err) {
      reportFailure(this, err, { withdrawing: false });
    }
  },

  /** 撤回后表单解锁 —— 除非假期本来就锁着它。 */
  applyTermStateAfterWithdraw() {
    if (!guard.canWriteThisTerm()) return;
    this.setData({ readonly: false, readonlyReason: '' });
  },

  onBackTap() {
    wx.navigateBack();
  },
});
