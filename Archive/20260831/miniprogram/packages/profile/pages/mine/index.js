/**
 * 教师个人档案 — APP-STRUCTURE.md screen id `TeacherProfile`。
 *
 * 原型 `screens/teacher-profile.html`。2026-08-27 补建：这一页此前整页没有，因为**契约里
 * 连读都没有**。缺口 G45 记着原因 —— 「教师直接改档案」与「教师提申请、管理员审批」两套
 * 契约互斥，未拍板前 API 契约只枚举管理端的 t3 审核侧。园方 2026-08-27 拍板走申请制，
 * 契约随之补齐三条（hualong-backend 6dbc5dd，v0.6），这一页才建得出来。
 *
 * ── 这一页只有一处写入，而它写的是一份申请 ──────────────────────────────────
 *
 * 教师读得到 canonical，改不了 canonical。「编辑」打开的弹层收的是
 * `db_teacher_profile_change.change_payload`，提交后 `NONE → s2` 进管理端审核队列。
 * 原型那枚按钮写的就是「提交审核」。
 *
 * 教职工自述的文本走 ADR-0016 第 2 行：**完整预览 ＋ 明确发布**。所以弹层里是
 * 编辑 → 预览 → 确认三步，不是一枚按钮直接发。证书原件是图片时另走图片那一条。
 */

const guard = require('../../../../utils/guard');
const profile = require('../../../../services/teacher-profile');
const moderation = require('../../../../utils/moderation');
const { reportFailure } = require('../../../../utils/present');

/**
 * 本页写入点的把关路径声明。**显式，无默认值**（ADR-0016）。
 *
 *   HUMAN_PREVIEW_CONFIRM   教职工自述的文本（职称、证书名称）—— 记录同意＋预览后发布。
 *   IMAGE_MEDIA_CHECK_ASYNC 证书原件可能是图片 —— 所有上传图片走服务端 mediaCheckAsync。
 */
const GATE_PATHS = [
  moderation.GATES.HUMAN_PREVIEW_CONFIRM,
  moderation.GATES.IMAGE_MEDIA_CHECK_ASYNC,
];

/** 一行新证书。`key` 只给 wx:for 用，不进请求体。 */
function emptyCredential(seq) {
  return {
    key: `new-${seq}`,
    credential_type: 'c2',
    credential_level: '',
    credential_name: '',
    file_id: 0,
    is_image: false,
  };
}

Page({
  data: {
    ready: false,
    loading: true,
    profile: null,
    options: {},

    editing: false,
    stage: 'edit',
    draft: { job_role: '', professional_title: '', education_level: '', credentials: [] },
    seq: 0,

    uploadingAt: -1,
    notice: '',

    preview: { lines: [] },
    previewedInFull: false,
    submitting: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true, options: profile.options() });
    this.load();
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    this.load();
  },

  async load() {
    try {
      const row = await profile.load();
      this.setData({ profile: row, loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  // ── 编辑弹层 ──────────────────────────────────────────────────────────────

  /**
   * 打开弹层。草稿从当前档案起手 —— 教师改的是「哪几格不一样」，让他从空白开始
   * 等于逼他把没变的也重填一遍。证书那一列起手是空的：申请里的证书是**新增**的那些。
   */
  onEditTap() {
    if (!this.data.profile) return;
    if (this.data.profile.pending_label) {
      this.setData({ notice: '上一份修改申请还在审核中，通过或驳回后才能再提交。' });
      return;
    }
    this.setData({
      editing: true,
      stage: 'edit',
      previewedInFull: false,
      notice: '',
      draft: {
        job_role: this.data.profile.job_role,
        professional_title: this.data.profile.professional_title,
        education_level: this.data.profile.education_level,
        credentials: [],
      },
    });
  },

  onCancelTap() {
    this.setData({ editing: false, stage: 'edit', previewedInFull: false, notice: '' });
  },

  /** 面板自己吃掉点击，只有遮罩关闭。 */
  onPanelTap() {},

  onChipTap(e) {
    const { field, key } = e.currentTarget.dataset;
    this.patch(field, key);
  },

  onTextInput(e) {
    this.patch(e.currentTarget.dataset.field, e.detail.value);
  },

  patch(field, value) {
    if (this.data.submitting) return;
    // 改了内容，上一次的预览就作废：预览过的必须是提交的那一份。
    this.setData({
      draft: { ...this.data.draft, [field]: value },
      previewedInFull: false,
      notice: '',
    });
  },

  // ── 证书行 ────────────────────────────────────────────────────────────────

  onAddCredential() {
    const seq = this.data.seq + 1;
    this.setData({
      seq,
      draft: { ...this.data.draft, credentials: this.data.draft.credentials.concat([emptyCredential(seq)]) },
      previewedInFull: false,
    });
  },

  onRemoveCredential(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({
      draft: {
        ...this.data.draft,
        credentials: this.data.draft.credentials.filter((_, i) => i !== index),
      },
      previewedInFull: false,
    });
  },

  onCredentialChipTap(e) {
    const { index, field, key } = e.currentTarget.dataset;
    this.patchCredential(Number(index), field, key);
  },

  onCredentialInput(e) {
    const { index, field } = e.currentTarget.dataset;
    this.patchCredential(Number(index), field, e.detail.value);
  },

  patchCredential(index, field, value) {
    const credentials = this.data.draft.credentials.map((c, i) => {
      if (i !== index) return c;
      const next = { ...c, [field]: value };
      // 学历证书没有等级类别（G37：学历层级的落点是「最高学历」，不是证书行）。
      if (field === 'credential_type' && value === 'c1') next.credential_level = '';
      return next;
    });
    this.setData({ draft: { ...this.data.draft, credentials }, previewedInFull: false, notice: '' });
  },

  /**
   * 选一份原件并直传。大小在选完的那一刻就判，不等上传失败 —— 那是本机答得出的问题。
   * 走的是资源库那条现成的媒体流（§8：签凭证 → 字节直传 → 落库拿 file_id）。
   */
  async onPickFile(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (this.data.uploadingAt >= 0 || this.data.submitting) return;

    let picked;
    try {
      picked = await profile.pickCredentialFile();
    } catch (err) {
      this.setData({ notice: err.message });
      return;
    }
    if (!picked) return;                       // 教师取消了。取消不是失败，不说话。

    this.setData({ uploadingAt: index, notice: '' });
    try {
      const fileId = await profile.uploadPickedFile(picked);
      this.setData({ uploadingAt: -1 });
      this.patchCredential(index, 'file_id', fileId);
      this.patchCredential(index, 'is_image', Boolean(picked.isImage));
    } catch (err) {
      this.setData({ uploadingAt: -1 });
      reportFailure(this, err, {});
    }
  },

  // ── 预览与提交 ────────────────────────────────────────────────────────────

  /**
   * 预览。把要提交的那一份冻结成文字 —— 预览的内容与提交的内容是**同一个对象**，
   * 教师之后改了字，`patch` 会把 `previewedInFull` 打回 false，必须重看一遍。
   */
  onPreviewTap() {
    const draft = this.data.draft;
    const bad = profile.tooLongNames(draft.credentials);
    if (bad.length) {
      this.setData({ notice: `这些证书名称超过 ${profile.CREDENTIAL_NAME_MAX} 字：${bad.join('、')}` });
      return;
    }
    const missing = draft.credentials.filter((c) => !c.credential_name || !c.file_id);
    if (missing.length) {
      this.setData({ notice: '每份证书都要填名称并上传原文件。' });
      return;
    }
    this.setData({
      stage: 'preview',
      previewedInFull: false,
      notice: '',
      preview: { lines: profile.previewLines(draft, this.data.options) },
    });
  },

  onPreviewEnd() {
    this.setData({ previewedInFull: true });
  },

  onBackToEdit() {
    this.setData({ stage: 'edit', previewedInFull: false });
  },

  /**
   * 确认提交（NONE -> s2）。
   *
   * 幂等键按「一次逻辑提交」生成一次并留在页面上：重复点击复用同一个，服务端按 §4.2
   * 回第一次的结果，因此只有一份待审申请。
   */
  async onConfirmTap() {
    if (!this.data.previewedInFull || this.data.submitting) return;

    const key = this.attemptKey || profile.newAttemptKey();
    this.attemptKey = key;
    const imageCount = this.data.draft.credentials.filter((c) => c.is_image).length;
    this.setData({ submitting: true, notice: '', errorText: '', errorRequestId: '', errorCanRetry: false });

    try {
      await profile.submitChange({
        gates: GATE_PATHS,
        draft: this.data.draft,
        previewedInFull: true,
        confirmed: true,
        imageCount,
        idempotencyKey: key,
      });
      this.setData({ submitting: false, editing: false, stage: 'edit' });
      wx.showToast({ title: '已提交审核', icon: 'none' });
      await this.load();
    } catch (err) {
      this.setData({ submitting: false });
      if (err instanceof moderation.ModerationError) {
        // 闸门拒绝时请求根本没发出，所以这不是一次服务故障，没有故障码可报。
        this.setData({ notice: err.message });
        return;
      }
      reportFailure(this, err, {});
    }
  },

  /** 证书原件的取档。两个词落到同一件事：§8.4 现签短时地址，再交给微信打开。 */
  onOpenFile(e) {
    const { id, name } = e.currentTarget.dataset;
    return profile.openCredentialFile({ file_id: id, file_name: name });
  },
});
