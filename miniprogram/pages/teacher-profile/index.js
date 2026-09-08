/**
 * 个人档案 —— 读 `GET /teacher-profile`，写 `POST /teacher-profile/changes`。
 *
 * 教师**改不了自己的档案**（G45 于 2026-08-27 拍申请制）：弹层收下的是一条修改
 * 申请，管理端 t3 队列批准后才落 canonical。所以按钮的字是「提交审核」。
 *
 * ── 三处与原型不同，都不是样式问题 ─────────────────────────────────────────
 *
 * 1. **姓名取自会话，任教班级一行不画。** 契约把这两个字段留在名册权威那边，随
 *    会话下发；而会话的 `scope` 只有 `class_id`，没有班级名，教师端也没有任何一条
 *    端点回本班班名。CLAUDE.md §8「没有数据源就不要渲染它」。
 * 2. **教龄与在园年数不画。** `first_taught_at`／`joined_school_at` 契约恒为 null，
 *    并逐字写着「不拿今年去减」。
 * 3. **证书行只有一个等级下拉，职称是输入框。** 理由在 `services/profile.js` 的
 *    头注（G37 与 `professional_title` 是自由文本那两段）。
 *
 * ── 两个「不能提交」分别由谁说 ─────────────────────────────────────────────
 *
 *   `pendingChange`  契约内嵌在 `GET /teacher-profile` 里的那条 `s2=待审核`。
 *                    **它决定编辑入口开不开** —— 一次读完就能说出「上一次改还在审」，
 *                    少一次往返，也避免两次读之间状态变了。
 *   `change`         `GET /teacher-profile/changes` 的第一条，**任何状态**。
 *                    它只用来在屏幕上说「上一次改到哪一步了」：`s3=已通过` 与
 *                    `s4=已驳回` 也要看得见，而那两个 `pendingChange` 里没有。
 *
 * `no_open_s2` 是登记表的前置，服务端会独立回 `state_precondition_failed`。
 * 界面上先说明原因**是礼貌，不是关卡**（与 §6.4 对 `current_term` 的口径同一条）。
 *
 * ── 证书原件选完当场就传 ───────────────────────────────────────────────────
 *
 * `change_payload` 的 `credentials[].file_id` 收的是**已经落库的** id，所以选完
 * 立刻走 `services/media.uploadFile`。一个看着像已上传、实际什么都没发生的条目，
 * 比一句「上传失败」糟得多。传失败的那一行留在表单里但没有 `file_id`，
 * `whyCannotSubmit()` 会指名是第几份。
 *
 * 只收图片（`mediaType: ['image']`）。要收 PDF 得改用 `wx.chooseMessageFile`
 * （从聊天记录里选），那是另一条入口，本页没有开。
 */

const profile = require('../../services/profile');
const media = require('../../services/media');
const guard = require('../../utils/guard');

/** 一行空的证书表单。类型默认 c1，等级默认「不填」。 */
function blankMaterial(key) {
  return {
    key,
    typeIndex: 0,
    levelIndex: 0,
    name: '',
    fileId: 0,
    fileName: '',
    uploading: false,
  };
}

Page({
  data: {
    loading: true,
    error: '',

    fields: [],
    groups: [],

    // 上一次改到哪一步了，没提过则 null。
    change: null,
    // 编辑入口不能开时的那句话，能开时是空串。
    blockReason: '',

    sheetOpen: false,
    submitting: false,

    jobRoleOptions: profile.JOB_ROLE_OPTIONS,
    educationOptions: profile.EDUCATION_OPTIONS,
    credentialTypeOptions: profile.CREDENTIAL_TYPE_OPTIONS,
    credentialLevelOptions: profile.CREDENTIAL_LEVEL_OPTIONS,

    title: '',
    titleMax: profile.TITLE_MAX,
    credentialNameMax: profile.CREDENTIAL_NAME_MAX,
    jobRoleIndex: 0,
    educationIndex: 0,
    materials: [],
    nextMaterialKey: 1,
  },

  onLoad() {
    return this.load();
  },

  /** 档案与申请各读一次。两条端点各回答一个问题，见头注。 */
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const data = await profile.getProfile();
      const change = await profile.latestChange();
      // 表单的初值就是当前档案：`change_payload` 只送要改的键，没有初值就比不出
      // 「改了什么」，整份档案会被当成一次全量修改送上去。
      const materials = data.credentials.map((c, i) => ({
        key: i + 1,
        typeIndex: profile.indexOfKey(profile.CREDENTIAL_TYPE_OPTIONS, c.type),
        levelIndex: profile.indexOfKey(profile.CREDENTIAL_LEVEL_OPTIONS, c.level),
        name: c.name,
        fileId: c.fileId,
        fileName: c.fileName,
        uploading: false,
      }));
      this.profile = data;
      this.setData({
        loading: false,
        fields: data.fields,
        groups: data.groups,
        change,
        blockReason: data.pendingChange
          ? '已有一份修改申请在审核中，通过或驳回之后才能再提交'
          : '',
        title: data.title,
        jobRoleIndex: profile.indexOfKey(profile.JOB_ROLE_OPTIONS, data.jobRole),
        educationIndex: profile.indexOfKey(profile.EDUCATION_OPTIONS, data.educationLevel),
        materials,
        nextMaterialKey: materials.length + 1,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({ loading: false, error: err.userMessage || '档案加载失败' });
    }
  },

  onRetry() {
    return this.load();
  },

  /* ── 证书原件：预览与下载是同一条链接，不是两条 ───────────────────────── */

  /**
   * 打开一份证书原件。`services/media.openFile` 一个函数管预览与下载 ——
   * 小程序上「预览」就是「下到临时文件再打开」，平台没有第二种打开方式。
   *
   * 宿主那一对由 `services/profile` 给（`owner_id` 是 `credential_id`，不是
   * `file_id`），**页面里不出现表名**。
   */
  async onOpenFile(e) {
    const { fileId, credentialId } = e.currentTarget.dataset;
    wx.showLoading({ title: '正在打开', mask: true });
    try {
      const res = await media.openFile(fileId, profile.credentialOwner(credentialId));
      wx.hideLoading();
      // placeholder 为真时授权是真的过了，只是这个环境不接对象存储。
      // 报成失败会把「权限不足」与「预览环境没有 COS」混为一谈。
      if (!res.opened && res.reason) {
        wx.showToast({ title: res.reason, icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '打不开这份文件', icon: 'none' });
    }
  },

  /* ── 修改申请弹层 ─────────────────────────────────────────────────────── */

  onOpenSheet() {
    if (this.data.blockReason) {
      wx.showToast({ title: this.data.blockReason, icon: 'none' });
      return;
    }
    this.setData({ sheetOpen: true });
  },

  onCloseSheet() {
    this.setData({ sheetOpen: false });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onJobRoleChange(e) {
    this.setData({ jobRoleIndex: Number(e.detail.value) });
  },

  onEducationChange(e) {
    this.setData({ educationIndex: Number(e.detail.value) });
  },

  onMaterialTypeChange(e) {
    this.setData({
      [`materials[${e.currentTarget.dataset.index}].typeIndex`]: Number(e.detail.value),
    });
  },

  onMaterialLevelChange(e) {
    this.setData({
      [`materials[${e.currentTarget.dataset.index}].levelIndex`]: Number(e.detail.value),
    });
  },

  onMaterialNameInput(e) {
    this.setData({
      [`materials[${e.currentTarget.dataset.index}].name`]: e.detail.value,
    });
  },

  /** 选一张图并**当场上传**。成功之后这一行才有 `file_id`，见头注。 */
  onPickFile(e) {
    const i = Number(e.currentTarget.dataset.index);
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => this.uploadPicked(i, res.tempFiles[0]),
    });
  },

  async uploadPicked(i, picked) {
    const { key } = this.data.materials[i];
    this.setData({ [`materials[${i}].uploading`]: true });
    try {
      const file = await media.uploadFile(picked.tempFilePath, {
        usageKey: profile.CREDENTIAL_USAGE,
        byteSize: picked.size,
      });
      this.finishUpload(key, file.fileId, file.name);
    } catch (err) {
      // 传失败就把这一行的 file_id 清掉：留着上一份的 id 会让教师以为换成功了。
      this.finishUpload(key, 0, '');
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '上传失败，请稍后重试', icon: 'none' });
    }
  },

  /**
   * 回填按行的 `key` 重新找下标，**不用选文件时那个下标**。
   *
   * 一发上传在飞的时候删掉它前面的一行，下标就整体前移了。照旧下标写回去，这一份
   * 文件会落到**另一张证书**上，而目标那一行永远停在「正在上传…」。
   * 行已经被删掉时什么都不写：那份文件就此作废，不另找一行安置它。
   */
  finishUpload(key, fileId, fileName) {
    const at = this.data.materials.findIndex((row) => row.key === key);
    if (at < 0) return;
    this.setData({
      [`materials[${at}].uploading`]: false,
      [`materials[${at}].fileId`]: fileId,
      [`materials[${at}].fileName`]: fileName,
    });
  },

  onAddMaterial() {
    const { materials, nextMaterialKey } = this.data;
    this.setData({
      materials: materials.concat(blankMaterial(nextMaterialKey)),
      nextMaterialKey: nextMaterialKey + 1,
    });
  },

  /**
   * 删掉一行。**这不只是收起一个表单行** —— `credentials` 是完整目标清单，
   * 删掉一行提交上去就是要求删掉那一张证书。原型的「最后一行删不掉」不照抄：
   * 一位教师完全可以一张证书都没有。
   */
  onRemoveMaterial(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ materials: this.data.materials.filter((_, index) => index !== i) });
  },

  /** 表单变成 service 收得下的形状。类型与等级由下标反查编码，页面不译。 */
  formValue() {
    return {
      title: this.data.title,
      jobRole: profile.JOB_ROLE_OPTIONS[this.data.jobRoleIndex].key,
      educationLevel: profile.EDUCATION_OPTIONS[this.data.educationIndex].key,
      credentials: this.data.materials.map((row) => ({
        type: profile.CREDENTIAL_TYPE_OPTIONS[row.typeIndex].key,
        level: profile.CREDENTIAL_LEVEL_OPTIONS[row.levelIndex].key,
        name: row.name,
        fileId: row.fileId,
      })),
    };
  },

  /**
   * 提交审核。**`full_preview_confirmed` 就在这一步**：把每一处改动逐条摆出来，
   * 教师按「确认提交」才发请求。
   *
   * 这是客户端行为，服务端验不了 —— 教师端没有 `preview_receipt` 那样的原语，
   * 契约自己写明了这一点。理由与代价写在 `services/profile.js` 的头注。
   */
  async onSubmitEdit() {
    if (this.data.submitting) return;
    const form = this.formValue();
    const why = profile.whyCannotSubmit(form, this.profile, this.data.change);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    const payload = profile.diffPayload(form, this.profile);
    const confirmed = await this.confirmSubmit(payload);
    if (!confirmed) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '正在提交', mask: true });
    try {
      await profile.submitChange(payload);
      wx.hideLoading();
      this.setData({ submitting: false, sheetOpen: false });
      wx.showToast({ title: '已提交审核', icon: 'success' });
      // 重读一次：`pendingChange` 与「上一次改到哪一步」都变了，而这两句话
      // 都是服务端说的，不在客户端本地推。
      await this.load();
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: profile.submitFailureText(err), icon: 'none' });
    }
  },

  /** 完整预览 ＋ 明确确认。resolve(true) 才发。 */
  confirmSubmit(payload) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '确认提交这些修改？',
        content: profile.previewText(payload, this.profile),
        confirmText: '确认提交',
        cancelText: '再看看',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
