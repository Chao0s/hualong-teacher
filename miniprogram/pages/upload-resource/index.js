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
 * 2. **封面与 Word 附件在本环境传不上去。** `POST /media/upload-credentials` 在
 *    契约服务端是 `not_implemented`（覆盖账本里登记着）。所以这两个入口点下去
 *    说明情况，不假装已上传 —— 原型的 `已选择Word附件` 토스트正是那种假装。
 *
 * 3. **年级是多选。** `db_resource.grade` 是 `TEXT[]`，DDL 注释写着「适用年级
 *    (多选)」；而 `db_case.case_grade` 是单值。两张表在这一列上不同形，表单
 *    因此也不同形，不强行统一。
 */

const library = require('../../services/library');
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
    coverPicked: false,

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
    } catch (err) {
      guard.endSessionOnAuthFailure(err);
    }
  },

  onTargetTap(e) {
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

  onPickCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: () => {
        this.setData({ coverPicked: true });
        // 选到了，但传不上去 —— 说清楚是哪一步没通，别让人以为已经存进去了。
        wx.showToast({ title: '已选择，但本环境尚未开放上传', icon: 'none' });
      },
    });
  },

  /** Word 附件：小程序选不了本地文档，且取证端点未实作。 */
  onPickWord() {
    wx.showToast({ title: '附件上传尚未开放', icon: 'none' });
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
    try {
      await guard.requireSession();
      const created = target === 'resource'
        ? await library.createResource({
          name: this.data.resource.name,
          tag: this.data.resourceTags[this.data.resourceTagIndex],
          grade: [],
          type: '文档',
          explain: this.data.resource.explain,
          access: this.data.resource.access,
          trans: this.data.resource.trans,
        })
        : await library.createCase({
          name: this.data.caseForm.name,
          grade: this.data.grades[this.data.gradeIndex],
          field: this.data.fields[this.data.fieldIndex],
          areas: this.data.caseAreas,
          intro: this.data.caseForm.intro,
          trans: this.data.caseForm.trans,
          resourceIds: this.data.selectedResourceId ? [this.data.selectedResourceId] : [],
        });

      const id = target === 'resource' ? created.resource_id : created.case_id;
      if (alsoSubmitForReview) await library.submitForReview(target, id);

      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: alsoSubmitForReview ? '已提交审核' : '已保存草稿', icon: 'success' });
      this.resetForm();
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '保存失败，请稍后重试', icon: 'none' });
    }
  },

  resetForm() {
    this.setData({
      resource: { ...EMPTY_RESOURCE },
      caseForm: { ...EMPTY_CASE },
      caseAreas: [],
      coverPicked: false,
      selectedResource: '暂无',
      selectedResourceMeta: '不关联现有资源',
      selectedResourceId: null,
    });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
