/**
 * 案例库 —— 数据来自 `GET /library/cases`。
 *
 * 原型把 9 条案例写死在这个文件里；已经删掉。三条筛选的取值现在都来自
 * services/library 的同一份枚举表，页面不再自己抄一份「健康语言社会科学艺术」。
 *
 * ── 三条筛选全部走服务端，多选靠并发多发 ───────────────────────────────────
 *
 * 契约给了 `case_grade`、`case_field`、`case_area` 三个参数，都用上。前两个是
 * 单选，直接发。
 *
 * 活动类型是**多选**，而契约的 `case_area` 是**单值** enum，列表行也不回这一列
 * （回了就能在客户端过滤，但它不回）。所以多选被翻译成并发多发：选中几项就发
 * 几条各自合法的单值查询，再按 `case_id` 去重合并。上限是 5，因为取值就 5 个。
 * 合并的那一段在 services/library.listCases 里，页面只管把选中的中文数组交出去。
 */

const library = require('../../services/library');
const guard = require('../../utils/guard');

// db_case 只有 10 行；§3.1 的上限是 100。
const PAGE_LIMIT = 100;

Page({
  data: {
    grades: ['all'],
    fields: ['all'],
    // 原型里「集体教学」这一项的按钮文字是「集体」，值仍是「集体教学」。
    // 那是显示上的缩写，不是另一个取值，所以缩写留在这里，全称在服务层。
    typeOptions: [],

    grade: 'all',
    field: 'all',
    types: ['all'],

    visible: [],
    countText: '',
    loading: true,
    error: '',
  },

  onLoad() {
    this.setData({
      grades: ['all'].concat(library.gradeFilters().filter((g) => g.key).map((g) => g.label)),
      fields: ['all'].concat(library.fieldFilters().filter((f) => f.key).map((f) => f.label)),
      typeOptions: [{ value: 'all', label: '全部' }].concat(
        library.areaFilters().filter((a) => a.key).map((a) => ({
          value: a.label,
          label: a.label === '集体教学' ? '集体' : a.label,
        }))
      ),
    });
    this.load();
  },

  onChipTap(e) {
    const { group, value } = e.currentTarget.dataset;

    if (group !== 'type') {
      this.setData({ [group]: value });
      this.load();
      return;
    }

    // 多选口径照抄原型：点「全部」清掉其余；取消到一个不剩时自动回到「全部」。
    let types;
    if (value === 'all') {
      types = ['all'];
    } else {
      const rest = this.data.types.filter((t) => t !== 'all');
      types = rest.includes(value) ? rest.filter((t) => t !== value) : rest.concat(value);
      if (!types.length) types = ['all'];
    }
    this.setData({ types });
    this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const { grade, field, types } = this.data;
      const page = await library.listCases({
        grade: grade === 'all' ? '' : grade,
        field: field === 'all' ? '' : field,
        areas: types.includes('all') ? [] : types,
        limit: PAGE_LIMIT,
      });
      this.setData({
        visible: page.items,
        countText: `${page.items.length} 个案例`,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        visible: [],
        countText: '',
        error: err.userMessage || '案例加载失败，请稍后重试',
      });
    }
  },

  onRetry() {
    this.load();
  },

  onCaseTap(e) {
    wx.navigateTo({ url: `/pages/case-detail/index?id=${e.currentTarget.dataset.id}` });
  },
});
