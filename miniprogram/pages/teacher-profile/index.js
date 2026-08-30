/**
 * 个人档案 —— 原型 screens/teacher-profile.html 的小程序版本。
 *
 * 两处规则照抄原型，都不是样式问题：
 *   1. 编辑弹层里姓名和任教班级是只读回显。两者由园方名冊维护，
 *      教师自助改档案只能改专业档案与证书，改这两项等于给自己改授权边界。
 *   2. 证书行的「类别」下拉是双用的：文件类型选「学历证书」时列本科/硕士/博士，
 *      其余时列校级…国家级。
 *
 * 提交前的校验也照抄：每一行都要有文件名称和已选文件，否则不提交。
 */

const EDUCATION_CATEGORIES = ['本科', '硕士', '博士'];
const LEVEL_CATEGORIES = ['校级', '区级', '市级', '省级', '国家级'];
const MATERIAL_TYPES = ['学历证书', '能力证书', '专业奖项'];

function categoriesFor(typeIndex) {
  return typeIndex === 0 ? EDUCATION_CATEGORIES : LEVEL_CATEGORIES;
}

Page({
  data: {
    teacher: { name: '林晓敏', className: '中一班' },

    profile: [
      { label: '姓名', value: '林晓敏' },
      { label: '任教班级', value: '中一班' },
      { label: '岗位', value: '主班' },
      { label: '职称', value: '一级' },
      { label: '首次任教', value: '2018.09（教龄 8 年）' },
      { label: '本园任职', value: '2021.09（在园 5 年）' },
      { label: '最高学历', value: '本科' },
    ],

    credentialGroups: [
      {
        subhead: '资格证书',
        items: [
          { name: '本科学历证书 · 心理学.pdf', badge: '学历证书' },
          { name: '硕士学历证书 · 学前教育学.pdf', badge: '学历证书' },
          { name: '幼儿园教师资格证.pdf', badge: '能力证书' },
          { name: '普通话水平测试二级甲等证书.pdf', badge: '能力证书' },
        ],
      },
      {
        subhead: '专业奖项',
        items: [
          { name: '区级课程案例一等奖.pdf', badge: '区级', award: true },
          { name: '园本课程资源共建优秀教师.pdf', badge: '校级', award: true },
        ],
      },
    ],

    sheetOpen: false,

    selects: [
      { key: 'role', label: '岗位', options: ['主班', '配班', '保育员', '教研组长', '其他'], index: 0 },
      { key: 'title', label: '职称', options: ['正高', '副高', '一级', '二级', '三级'], index: 2 },
      { key: 'education', label: '最高学历', options: ['中专', '大专', '本科', '硕士', '博士', '其他'], index: 2 },
    ],

    materialTypes: MATERIAL_TYPES,
    materials: [
      { id: 1, typeIndex: 0, categories: EDUCATION_CATEGORIES, categoryIndex: 0, name: '学士学位证', file: '' },
      { id: 2, typeIndex: 1, categories: LEVEL_CATEGORIES, categoryIndex: 0, name: '幼儿园教师资格证', file: '' },
    ],
    nextMaterialId: 3,
  },

  onOpenSheet() {
    this.setData({ sheetOpen: true });
  },

  onCloseSheet() {
    this.setData({ sheetOpen: false });
  },

  onSelectChange(e) {
    const key = e.currentTarget.dataset.key;
    const i = this.data.selects.findIndex((s) => s.key === key);
    this.setData({ [`selects[${i}].index`]: Number(e.detail.value) });
  },

  onMaterialTypeChange(e) {
    const i = e.currentTarget.dataset.index;
    const typeIndex = Number(e.detail.value);
    // 类别列表跟着文件类型换，已选项重置到第一项
    this.setData({
      [`materials[${i}].typeIndex`]: typeIndex,
      [`materials[${i}].categories`]: categoriesFor(typeIndex),
      [`materials[${i}].categoryIndex`]: 0,
    });
  },

  onMaterialCategoryChange(e) {
    this.setData({ [`materials[${e.currentTarget.dataset.index}].categoryIndex`]: Number(e.detail.value) });
  },

  onMaterialNameInput(e) {
    this.setData({ [`materials[${e.currentTarget.dataset.index}].name`]: e.detail.value });
  },

  onPickFile(e) {
    const i = e.currentTarget.dataset.index;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        const path = res.tempFiles[0].tempFilePath;
        this.setData({ [`materials[${i}].file`]: path.split('/').pop() });
      },
    });
  },

  onAddMaterial() {
    const { materials, nextMaterialId } = this.data;
    this.setData({
      materials: materials.concat({
        id: nextMaterialId, typeIndex: 0, categories: EDUCATION_CATEGORIES, categoryIndex: 0, name: '', file: '',
      }),
      nextMaterialId: nextMaterialId + 1,
    });
  },

  onRemoveMaterial(e) {
    // 原型只在多于一行时才显示删除按钮，最后一行删不掉
    if (this.data.materials.length <= 1) return;
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ materials: this.data.materials.filter((_, index) => index !== i) });
  },

  onSubmitEdit() {
    const incomplete = this.data.materials.some((row) => !row.name.trim() || !row.file);
    if (incomplete) {
      wx.showToast({ title: '请为每份文件填写名称并上传原文件', icon: 'none' });
      return;
    }
    this.setData({ sheetOpen: false });
    wx.showToast({ title: '已提交审核，审核通过后自动更新', icon: 'none' });
  },

  onToast(e) {
    wx.showToast({ title: e.currentTarget.dataset.action, icon: 'none' });
  },

  // 浮层内部点击不关窗；catchtap 需要一个真实的处理函数
  noop() {},
});
