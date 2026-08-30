/**
 * 案例库 —— 原型 screens/case-library.html 的小程序版本。
 *
 * 筛选口径照抄原型脚本：
 *   年级、领域是单选，点哪个就只留哪个；
 *   活动类型是多选，点「全部」会清掉其余选项，取消到一个不剩时自动回到「全部」；
 *   一张卡命中的条件是 年级 且 领域 且 (类型交集非空)。
 */

const CASES = [
  { name: '祠堂里的故事', grade: '大班', field: '社会', types: ['集体教学', '主题探究'], thumb: '祠堂\n探访', tone: 'accent', pills: ['社会', '集体教学', '主题探究'] },
  { name: '龙舟竞渡', grade: '大班', field: '健康', types: ['集体教学', '区域'], thumb: '龙舟\n竞渡', tone: 'amber', pills: ['健康', '集体教学', '区域'] },
  { name: '番禺美食地图', grade: '中班', field: '科学', types: ['区域', '数字化'], thumb: '美食\n地图', tone: 'green', pills: ['科学', '区域', '数字化'] },
  { name: '粤语童谣共唱', grade: '小班', field: '语言', types: ['家园社共育', '区域'], thumb: '童谣\n共唱', tone: 'blue', pills: ['语言', '家园社共育', '区域'] },
  { name: '砖雕纹样拓印', grade: '中班', field: '艺术', types: ['主题探究', '数字化'], thumb: '纹样\n拓印', tone: 'green', pills: ['艺术', '主题探究', '数字化'] },
  { name: '桥有多长', grade: '大班', field: '科学', types: ['主题探究', '数字化'], thumb: '桥梁\n测量', tone: 'blue', pills: ['科学', '主题探究', '数字化'] },
  { name: '我会安全过街', grade: '小班', field: '健康', types: ['家园社共育', '数字化'], thumb: '安全\n路线', tone: 'amber', pills: ['健康', '家园社共育', '数字化'] },
  { name: '社区小店的一天', grade: '中班', field: '社会', types: ['区域', '集体教学'], thumb: '社区\n小店', tone: 'accent', pills: ['社会', '区域', '集体教学'] },
  { name: '采访老街坊', grade: '大班', field: '语言', types: ['集体教学', '家园社共育'], thumb: '采访\n记录', tone: 'blue', pills: ['语言', '集体教学', '家园社共育'] },
];

Page({
  data: {
    grades: ['all', '小班', '中班', '大班'],
    fields: ['all', '健康', '语言', '社会', '科学', '艺术'],
    // 原型里「集体教学」这一项的按钮文字是「集体」，值仍是「集体教学」
    typeOptions: [
      { value: 'all', label: '全部' },
      { value: '集体教学', label: '集体' },
      { value: '区域', label: '区域' },
      { value: '主题探究', label: '主题探究' },
      { value: '家园社共育', label: '家园社共育' },
      { value: '数字化', label: '数字化' },
    ],

    grade: 'all',
    field: 'all',
    types: ['all'],

    visible: CASES,
    countText: '',
  },

  onLoad() {
    this.applyFilters();
  },

  onChipTap(e) {
    const { group, value } = e.currentTarget.dataset;

    if (group !== 'type') {
      this.setData({ [group]: value });
      this.applyFilters();
      return;
    }

    let types;
    if (value === 'all') {
      types = ['all'];
    } else {
      const rest = this.data.types.filter((t) => t !== 'all');
      types = rest.includes(value) ? rest.filter((t) => t !== value) : rest.concat(value);
      if (!types.length) types = ['all'];
    }
    this.setData({ types });
    this.applyFilters();
  },

  applyFilters() {
    const { grade, field, types } = this.data;
    const visible = CASES.filter((item) => {
      const okGrade = grade === 'all' || item.grade === grade;
      const okField = field === 'all' || item.field === field;
      const okType = types.includes('all') || types.some((t) => item.types.includes(t));
      return okGrade && okField && okType;
    });
    this.setData({ visible, countText: `${visible.length} 个案例` });
  },

  onCaseTap() {
    wx.navigateTo({ url: '/pages/case-detail/index' });
  },
});
