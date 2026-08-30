/**
 * 上传资料 —— 原型 screens/upload-resource.html 的小程序版本。
 *
 * 两套表单按「上传目标」切换，字段和字数上限逐条照抄原型。
 * 选择器浮层的筛选口径也照抄：「暂无」这一项永远显示，不参与筛选。
 *
 * 原型的 <select> 换成 <picker mode="selector">；封面图片用 wx.chooseMedia，
 * Word 附件小程序选不了本地文档，弹提示。
 */

const CASES = [
  { name: '暂无', grade: '全部', field: '全部', meta: '不关联现有案例' },
  { name: '祠堂里的故事', grade: '大班', field: '社会', meta: '留耕堂资源转化' },
  { name: '龙舟竞渡', grade: '大班', field: '健康', meta: '合作运动游戏' },
  { name: '番禺美食地图', grade: '中班', field: '科学', meta: '食材观察与分类' },
  { name: '粤语童谣共唱', grade: '小班', field: '语言', meta: '方言童谣采集' },
  { name: '砖雕纹样拓印', grade: '中班', field: '艺术', meta: '岭南纹样表达' },
];

const RESOURCES = [
  { name: '暂无', tag: '全部', meta: '不关联现有资源' },
  { name: '香云纱纹样', tag: '衣', meta: '传统织物纹样' },
  { name: '广绣小包', tag: '衣', meta: '手工与服饰资源' },
  { name: '双皮奶', tag: '食', meta: '本土饮食材料' },
  { name: '留耕堂', tag: '住', meta: '宗祠建筑观察' },
  { name: '沙湾古镇', tag: '住', meta: '社区空间走访' },
  { name: '龙舟竞渡', tag: '行', meta: '水乡出行与竞渡' },
  { name: '醒狮纹样', tag: '艺', meta: '岭南艺术表达' },
];

Page({
  data: {
    type: 'resource',
    targets: [
      { key: 'resource', glyph: '资', title: '课程资源库', desc: '本土材料、解读、获取与转化' },
      { key: 'case', glyph: '案', title: '课程案例库', desc: '活动案例、年级领域与关联资源' },
    ],

    teacher: { name: '陈老师', className: '大一班' },
    coverPicked: false,

    resourceTags: ['衣', '食', '住', '行', '艺'],
    resourceTagIndex: 2,
    resource: {
      name: '沙湾留耕堂 · 何氏宗祠',
      explain: '从宗祠空间、木构梁架、砖雕纹样和族群记忆切入，帮助幼儿理解社区建筑承载的生活经验与公共文化。',
      access: '教师可组织家长周末拍摄门楼、天井、厅堂和周边街巷照片，也可由园所统一整理安全可用的参观照片、讲解词和观察记录表。',
      trans: '可转化为建筑观察、纹样拓印、社区地图和口述故事活动，引导幼儿从看见建筑到表达生活经验。',
    },

    grades: ['小班', '中班', '大班'],
    gradeIndex: 2,
    fields: ['健康', '语言', '社会', '科学', '艺术'],
    fieldIndex: 2,
    caseForm: {
      name: '祠堂里的故事',
      intro: '幼儿围绕留耕堂建筑照片和参观见闻，讲述自己看到的门楼、天井与家族故事。',
      trans: '活动从照片观察进入故事表达，再延伸到亲子走访和班级地图制作。',
    },

    selectedCase: '暂无',
    selectedCaseMeta: '不关联现有案例',
    selectedResource: '暂无',
    selectedResourceMeta: '不关联现有资源',

    // 浮层状态
    picker: '',
    filterA: '全部',
    filterB: '全部',
    filterAOptions: [],
    filterBOptions: [],
    options: [],
    currentSelection: '',
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

  onPickCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: () => {
        this.setData({ coverPicked: true });
        wx.showToast({ title: '已选择封面图片', icon: 'none' });
      },
    });
  },

  /* ── 选择器浮层 ────────────────────────────────────────────────────── */

  onOpenPicker(e) {
    const picker = e.currentTarget.dataset.picker;
    this.setData({
      picker,
      filterA: '全部',
      filterB: '全部',
      filterAOptions: picker === 'case' ? ['全部', '小班', '中班', '大班'] : ['全部', '衣', '食', '住', '行', '艺'],
      filterBOptions: picker === 'case' ? ['全部', '健康', '语言', '社会', '科学', '艺术'] : [],
      currentSelection: picker === 'case' ? this.data.selectedCase : this.data.selectedResource,
    });
    this.refreshOptions();
  },

  onFilterTap(e) {
    const { group, value } = e.currentTarget.dataset;
    this.setData({ [group === 'A' ? 'filterA' : 'filterB']: value });
    this.refreshOptions();
  },

  /** 筛选口径照抄原型：「暂无」永远留下，其余按已选筛选条件过。 */
  refreshOptions() {
    const isCase = this.data.picker === 'case';
    const list = isCase ? CASES : RESOURCES;
    const { filterA, filterB } = this.data;

    const options = list
      .filter((row) => {
        if (row.name === '暂无') return true;
        if (isCase) {
          return (filterA === '全部' || row.grade === filterA) && (filterB === '全部' || row.field === filterB);
        }
        return filterA === '全部' || row.tag === filterA;
      })
      .map((row) => ({
        name: row.name,
        label: row.name === '暂无' ? row.meta
          : isCase ? `${row.grade} · ${row.field} · ${row.meta}`
            : `${row.tag} · ${row.meta}`,
      }));

    this.setData({ options });
  },

  onOptionTap(e) {
    const name = e.currentTarget.dataset.name;
    const isCase = this.data.picker === 'case';
    const hit = (isCase ? CASES : RESOURCES).find((row) => row.name === name);
    this.setData(isCase
      ? { selectedCase: name, selectedCaseMeta: hit.meta, picker: '' }
      : { selectedResource: name, selectedResourceMeta: hit.meta, picker: '' });
  },

  onClosePicker() {
    this.setData({ picker: '' });
  },

  onToast(e) {
    wx.showToast({ title: e.currentTarget.dataset.action, icon: 'none' });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
