/**
 * 上传资料 —— 写入 `POST /library/resources` 与 `POST /library/cases`。
 *
 * 原型在这个文件里写死了两份下拉清单（6 个案例、8 个资源）和一整份填好的示范
 * 表单；两者都已删掉。清单现在从库里取，表单初始为空。
 *
 * ── 三处按契约做的删改，逐条说明 ───────────────────────────────────────────
 *
 * 1. **资源表单的「课程应用」选择器已移除。** 契约的 `ResourceWrite` 只有
 *    resource_type／resource_name／resource_tag／grade／三段正文／两个 file_id，
 *    **没有 case_ids**。关联关系记在 `db_case.resource_ids` 那一侧，方向是
 *    案例引用资源。留着这个选择器，教师选完之后那个值会被静默丢掉 —— 一个收下
 *    输入却不保存的控件比没有这个控件更糟。案例表单的「关联资源」保留，它对应
 *    `CaseWrite.resource_ids`，是真的存得下去的那一侧。
 *
 * 2. **Word 附件只能从微信聊天记录里选。** 小程序没有手机文件系统选择器：
 *    `wx.chooseMessageFile` 只读得到用户在微信聊天里收发过的文件，这是平台的
 *    边界，不是本页的偷懒。所以按钮写「从聊天选」而不是「上传」——「上传」会让
 *    人去相册和文件管理器里找一个找不到的入口。教师的做法是先把 .docx 发给
 *    「文件传输助手」，再回来选；点了没选到时，页面就把这句话说出来。
 *    扩展名锁死 `docx`：契约的 6 值 `content_type` 枚举里 Word 只有 .docx 这一种。
 *
 * 3. **Word 附件落库的就是教师挑的那个文件名。** `services/media.js` 把
 *    `wx.chooseMessageFile` 回的 `name` 随 `POST /media/files` 送上去（G77 已修）。
 *    封面走 `wx.chooseMedia`，图片没有原名，服务端派生一个。
 *
 * 4. **年级是多选。** `db_resource.grade` 是 `TEXT[]`，DDL 注释写着「适用年级
 *    (多选)」；而 `db_case.case_grade` 是单值。两张表在这一列上不同形，表单
 *    因此也不同形，不强行统一。
 *
 * ── 「我的上传」与改草稿（#67） ─────────────────────────────────────────────
 *
 * 页顶列出本人上传过的资源与案例，分两组：「草稿（含被驳回）」与「已提交／已通过」。
 * 分组、能不能改、驳回理由全部由 `library.listMyUploads()` 给（`drafts`／`submitted`／
 * `editable`／`reviewNote`），页面不判状态码。点一条可改的，把它的正文回填进下面
 * 同一张表单（`editing` 非空），「保存草稿」变成 PATCH，「提交审核」是 PATCH 之后
 * 再走一次 `/submission`（s4 直接重交，F27）。编辑时不换封面与附件：`PATCH` 的
 * 请求体只收正文那几格。
 */

const library = require('../../services/library');
const media = require('../../services/media');
const guard = require('../../utils/guard');
const session = require('../../utils/session');

// 字数上限由 wxml 的 maxlength 拦，与 DDL 的 VARCHAR 长度一一对应，
// 这里不再存第二份 —— 存两份就会有一天对不上。
const EMPTY_RESOURCE = { name: '', explain: '', access: '', trans: '' };
const EMPTY_CASE = { name: '', intro: '', trans: '' };

Page({
  data: {
    type: 'resource',
    targets: [
      { key: 'resource', glyph: '资', title: '课程资源库', desc: '本土材料、解读、获取与转化' },
      { key: 'case', glyph: '案', title: '课程案例库', desc: '活动案例、年级领域与关联资源' },
    ],

    // 从会话读，不再写死「陈老师 / 大一班」
    teacher: { name: '', className: '' },

    // 封面与 Word 附件。id 是落库之后的 file_id，note 是屏幕上那一行字。
    coverFileId: null,
    coverNote: '未选择文件',
    wordFileId: null,
    wordNote: '',

    // 取值全部来自服务层的枚举表
    resourceTags: [],
    resourceTagIndex: 0,
    resource: { ...EMPTY_RESOURCE },

    grades: [],
    gradeIndex: 0,
    fields: [],
    fieldIndex: 0,
    // 活动类型。原型的上传表单没有这一项，但 db_case.case_area 是 TEXT[] NOT NULL，
    // 缺了它这张表单永远提交不成功。多选，理由见 wxml 里同名注释。
    areaOptions: [],
    caseAreas: [],
    caseForm: { ...EMPTY_CASE },

    // 案例表单的「关联资源」。资源表单那一侧已移除，理由见头注第 1 条。
    selectedResource: '暂无',
    selectedResourceMeta: '不关联现有资源',
    selectedResourceId: null,

    // 「我的上传」两组，与正在改的那一条（null = 新建）。见头注最后一节。
    myDrafts: [],
    mySubmitted: [],
    uploadsLoaded: false,
    editing: null,

    // 浮层状态
    picker: '',
    filterA: '全部',
    filterAOptions: [],
    options: [],
    currentSelection: '',
    submitting: false,
  },

  async onLoad() {
    this.setData({
      resourceTags: library.tagFilters().filter((t) => t.key).map((t) => t.label),
      grades: library.gradeFilters().filter((g) => g.key).map((g) => g.label),
      fields: library.fieldFilters().filter((f) => f.key).map((f) => f.label),
      areaOptions: library.areaFilters().filter((a) => a.key).map((a) => a.label),
    });
    try {
      await guard.requireSession();
      const subject = session.getSubject() || {};
      const scope = session.getScope() || {};
      this.setData({
        teacher: {
          name: subject.teacher_name || '',
          className: scope.class_name || '',
        },
      });
      await this.loadMyUploads();
    } catch (err) {
      guard.endSessionOnAuthFailure(err);
    }
  },

  /** 「我的上传」两组。失败只 toast，表单照常可用 —— 列表不是上传的前置。 */
  async loadMyUploads() {
    try {
      const mine = await library.listMyUploads({ limit: 100 });
      this.setData({ myDrafts: mine.drafts, mySubmitted: mine.submitted, uploadsLoaded: true });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({ uploadsLoaded: true });
      wx.showToast({ title: err.userMessage || '我的上传加载失败', icon: 'none' });
    }
  },

  /**
   * 点「我的上传」里的一条：可改的回填进表单进入编辑；不可改的把那句话说出来。
   * 能不能改由 service 给（`editable`），这里不看状态码。
   */
  async onMyUploadTap(e) {
    const { kind, id } = e.currentTarget.dataset;
    const row = this.data.myDrafts.concat(this.data.mySubmitted)
      .find((r) => r.kind === kind && r.id === Number(id));
    if (!row) return;
    if (!row.editable) {
      wx.showToast({ title: row.note, icon: 'none' });
      return;
    }
    try {
      await guard.requireSession();
      const draft = kind === 'case'
        ? await library.caseDraft(row.id)
        : await library.resourceDraft(row.id);
      if (!draft.editable) {
        wx.showToast({ title: '这一条现在不能改', icon: 'none' });
        await this.loadMyUploads();
        return;
      }
      this.fillForm(draft);
      wx.pageScrollTo({ selector: '.form', duration: 300 });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '读取草稿失败', icon: 'none' });
    }
  },

  /** 把一条草稿的正文放进表单。picker 存的是下标，所以按标签反查。 */
  fillForm(draft) {
    const patch = {
      type: draft.kind,
      editing: { kind: draft.kind, id: draft.id, name: draft.name, reviewNote: draft.reviewNote },
      // 编辑时不换封面与附件（PATCH 不收那两格），清掉表单里残留的 file_id。
      coverFileId: null,
      coverNote: '未选择文件',
      wordFileId: null,
      wordNote: '',
    };
    if (draft.kind === 'resource') {
      const tagIndex = this.data.resourceTags.indexOf(draft.tag);
      patch.resource = { name: draft.name, explain: draft.explain, access: draft.access, trans: draft.trans };
      patch.resourceTagIndex = tagIndex > -1 ? tagIndex : 0;
    } else {
      const gradeIndex = this.data.grades.indexOf(draft.grade);
      const fieldIndex = this.data.fields.indexOf(draft.field);
      patch.caseForm = { name: draft.name, intro: draft.intro, trans: draft.trans };
      patch.gradeIndex = gradeIndex > -1 ? gradeIndex : 0;
      patch.fieldIndex = fieldIndex > -1 ? fieldIndex : 0;
      patch.caseAreas = draft.areas;
    }
    this.setData(patch);
  },

  onCancelEdit() {
    this.resetForm();
  },

  onTargetTap(e) {
    // 编辑中切目标没有意义：一条资源改不成案例。先取消编辑再切。
    if (this.data.editing) {
      wx.showToast({ title: '先取消编辑，再切换上传目标', icon: 'none' });
      return;
    }
    this.setData({ type: e.currentTarget.dataset.type });
  },

  onResourceInput(e) {
    this.setData({ [`resource.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  onCaseInput(e) {
    this.setData({ [`caseForm.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  onResourceTagChange(e) {
    this.setData({ resourceTagIndex: Number(e.detail.value) });
  },

  onGradeChange(e) {
    this.setData({ gradeIndex: Number(e.detail.value) });
  },

  onFieldChange(e) {
    this.setData({ fieldIndex: Number(e.detail.value) });
  },

  /** 活动类型是多选，点一下切换选中。至少要选一个，`case_area` 是 NOT NULL。 */
  onAreaTap(e) {
    const value = e.currentTarget.dataset.value;
    const current = this.data.caseAreas;
    this.setData({
      caseAreas: current.includes(value)
        ? current.filter((a) => a !== value)
        : current.concat(value),
    });
  },

  /** 封面：选一张图片，传上去，留下 file_id。资源与案例两张表单共用这一个。 */
  onPickCover() {
    wx.chooseMedia({
      count: 1,
      // 封面只要图片。DO-NOT-BUILD 12 那条针对的是在园时光与亲子任务，这里同样
      // 没有影片的位置：`db_resource.cover_file_id` 存的是封面。
      mediaType: ['image'],
      success: (res) => {
        const picked = (res.tempFiles || [])[0];
        if (picked) this.uploadCover(picked);
      },
    });
  },

  /**
   * Word 附件：从微信聊天记录里选一份 .docx。
   *
   * `fail` 里那句话是这一页最要紧的一句：点不出东西来的时候，教师需要知道
   * 「文件要先发到聊天里」，而不是以为功能坏了。见头注第 2 条。
   */
  onPickWord() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['docx'],
      success: (res) => {
        const picked = (res.tempFiles || [])[0];
        if (picked) this.uploadWord(picked);
      },
      fail: () => {
        this.setData({ wordNote: '没有选到文件。请先把文档发到微信聊天（例如「文件传输助手」），再回来选。' });
      },
    });
  },

  /**
   * 传封面。三步在 service 里（签发凭证 → 传字节 → 落库），这里只管屏幕上那一行字。
   *
   * 失败时把 `coverFileId` 清掉：留着上一次成功的 id，教师看到的是「上传失败」，
   * 提交时却带着一张旧封面出去。
   */
  async uploadCover(picked) {
    this.setData({ coverNote: '正在上传封面…' });
    try {
      await guard.requireSession();
      const file = await media.uploadFile(picked.tempFilePath, {
        usageKey: media.USAGE.IMAGE,
        byteSize: picked.size,
      });
      this.setData({ coverFileId: file.fileId, coverNote: '已上传封面' });
    } catch (err) {
      this.setData({ coverFileId: null, coverNote: '封面上传失败，点此重试' });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '封面上传失败，请稍后重试', icon: 'none' });
    }
  },

  /** 传 Word 附件。显示的是教师挑的那个文件名，理由见头注第 3 条。 */
  async uploadWord(picked) {
    this.setData({ wordNote: '正在上传附件…' });
    try {
      await guard.requireSession();
      const file = await media.uploadFile(picked.path, {
        usageKey: media.USAGE.MAIN_FILE,
        byteSize: picked.size,
        fileName: picked.name,
      });
      this.setData({ wordFileId: file.fileId, wordNote: `已上传：${picked.name}` });
    } catch (err) {
      this.setData({ wordFileId: null, wordNote: '附件上传失败，点此重试' });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '附件上传失败，请稍后重试', icon: 'none' });
    }
  },

  /* ── 选择器浮层：只剩案例表单的「关联资源」 ────────────────────────────── */

  async onOpenPicker() {
    this.setData({
      picker: 'resource',
      filterA: '全部',
      filterAOptions: ['全部'].concat(library.tagFilters().filter((t) => t.key).map((t) => t.label)),
      currentSelection: this.data.selectedResource,
      options: [],
    });
    this.refreshOptions();
  },

  onFilterTap(e) {
    this.setData({ filterA: e.currentTarget.dataset.value });
    this.refreshOptions();
  },

  /**
   * 「暂无」永远留下（口径照抄原型），其余按分类筛 —— 而且是**服务端**筛，
   * 因为契约给了 `resource_tag` 这个参数。
   */
  async refreshOptions() {
    const tag = this.data.filterA === '全部' ? '' : this.data.filterA;
    const none = { id: null, name: '暂无', label: '不关联现有资源' };
    try {
      const page = await library.listResources({ tag, limit: 100 });
      this.setData({
        options: [none].concat(page.items.map((row) => ({
          id: row.id,
          name: row.name,
          label: [row.tagLabel, row.gradeLabel].filter(Boolean).join(' · '),
        }))),
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({ options: [none] });
      wx.showToast({ title: err.userMessage || '资源清单加载失败', icon: 'none' });
    }
  },

  onOptionTap(e) {
    const { id, name } = e.currentTarget.dataset;
    const hit = this.data.options.find((row) => row.name === name);
    this.setData({
      selectedResource: name,
      selectedResourceMeta: hit ? hit.label : '',
      selectedResourceId: id || null,
      picker: '',
    });
  },

  onClosePicker() {
    this.setData({ picker: '' });
  },

  /* ── 提交 ──────────────────────────────────────────────────────────────── */

  onSaveDraft() {
    this.submit(false);
  },

  onSubmitReview() {
    this.submit(true);
  },

  /**
   * 缺必填就说缺哪一个，不要只说「填写有误」。
   *
   * 这份清单来自 `db/01_schema.sql` 的 NOT NULL 列，不是照着表单眼估的：
   *   db_resource  resource_type／resource_name／resource_tag／
   *                resource_explain／resource_access／resource_trans
   *   db_case      case_name／case_grade／case_field／case_area／
   *                case_intro／case_trans
   * `school_id` 与 `created_by` 同样 NOT NULL，但它们是 derived，服务端自己填。
   * `db_resource.grade` 可空，所以年级不在必填里。
   *
   * 少查一条的后果不是报错文案难看，是服务端回 422，而教师看不出该改哪一格。
   */
  missingField() {
    if (this.data.type === 'resource') {
      const r = this.data.resource;
      if (!r.name.trim()) return '资源名称';
      if (!r.explain.trim()) return '资源解读';
      if (!r.access.trim()) return '资源获取';
      if (!r.trans.trim()) return '资源转化';
      return '';
    }
    const c = this.data.caseForm;
    if (!c.name.trim()) return '案例名称';
    if (!this.data.caseAreas.length) return '活动类型（至少选一项）';
    if (!c.intro.trim()) return '活动简介';
    if (!c.trans.trim()) return '活动转化';
    return '';
  },

  /**
   * 保存草稿建一条 s1；提交审核在建完之后再走一次 s1 -> s2。
   *
   * 分两步是契约的形状，不是这里多绕一道：`POST /library/resources` 只建草稿，
   * 状态迁移由 `/submission` 这条独立的端点做。把两者合成一个「发布」按钮会让
   * 「存了但没提交」这个真实存在的中间态没有出口。
   */
  async submit(alsoSubmitForReview) {
    if (this.data.submitting) return;

    const missing = this.missingField();
    if (missing) {
      wx.showToast({ title: `请先填写${missing}`, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: alsoSubmitForReview ? '正在提交' : '正在保存', mask: true });

    const target = this.data.type;
    const editing = this.data.editing;
    try {
      await guard.requireSession();
      if (editing) {
        // 改草稿：PATCH 正文那几格；提交审核再走一次 /submission（s1 或 s4 → s2）。
        if (editing.kind === 'resource') {
          await library.updateResource(editing.id, {
            name: this.data.resource.name,
            explain: this.data.resource.explain,
            access: this.data.resource.access,
            trans: this.data.resource.trans,
          });
          if (alsoSubmitForReview) await library.submitResource(editing.id);
        } else {
          await library.updateCase(editing.id, {
            name: this.data.caseForm.name,
            intro: this.data.caseForm.intro,
            trans: this.data.caseForm.trans,
          });
          if (alsoSubmitForReview) await library.submitCase(editing.id);
        }
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: alsoSubmitForReview ? '已重新提交审核' : '已保存修改', icon: 'success' });
        this.resetForm();
        await this.loadMyUploads();
        return;
      }
      const created = target === 'resource'
        ? await library.createResource({
          name: this.data.resource.name,
          tag: this.data.resourceTags[this.data.resourceTagIndex],
          grade: [],
          type: '文档',
          explain: this.data.resource.explain,
          access: this.data.resource.access,
          trans: this.data.resource.trans,
          coverFileId: this.data.coverFileId,
          wordFileId: this.data.wordFileId,
        })
        : await library.createCase({
          name: this.data.caseForm.name,
          grade: this.data.grades[this.data.gradeIndex],
          field: this.data.fields[this.data.fieldIndex],
          areas: this.data.caseAreas,
          intro: this.data.caseForm.intro,
          trans: this.data.caseForm.trans,
          resourceIds: this.data.selectedResourceId ? [this.data.selectedResourceId] : [],
          coverFileId: this.data.coverFileId,
          wordFileId: this.data.wordFileId,
        });

      const id = target === 'resource' ? created.resource_id : created.case_id;
      if (alsoSubmitForReview) {
        await (target === 'resource' ? library.submitResource(id) : library.submitCase(id));
      }

      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: alsoSubmitForReview ? '已提交审核' : '已保存草稿', icon: 'success' });
      this.resetForm();
      await this.loadMyUploads();
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '保存失败，请稍后重试', icon: 'none' });
    }
  },

  resetForm() {
    this.setData({
      editing: null,
      resource: { ...EMPTY_RESOURCE },
      caseForm: { ...EMPTY_CASE },
      caseAreas: [],
      // 建完一条就清掉两个 file_id：**不重用**。下一条内容再传一次，一张封面对
      // 一条内容 —— 留着上一条的 id，教师看到的是一张空表单，发出去的却带着旧封面。
      coverFileId: null,
      coverNote: '未选择文件',
      wordFileId: null,
      wordNote: '',
      selectedResource: '暂无',
      selectedResourceMeta: '不关联现有资源',
      selectedResourceId: null,
    });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
