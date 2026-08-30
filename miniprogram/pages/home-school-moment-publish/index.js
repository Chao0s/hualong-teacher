/**
 * 发布活动 —— 原型 screens/home-school-moment-publish.html 的小程序版本。
 *
 * 三处行为照抄原型：
 *   1. 改标题、改评语、改勾选都会把状态字改成「保存中…」，600ms 后回到「已自动保存」。
 *   2. 发布前校验：标题非空、至少一名幼儿、评语和照片至少有一个。
 *   3. 通过校验后只改状态字，不真的发布。
 */

const AUTOSAVE_DELAY = 600;

Page({
  data: {
    title: '端午手作：艾草香囊',
    content: '孩子们能主动选择材料，尝试闻一闻、摸一摸艾草，并在穿绳和装袋环节互相提醒，整体参与度较高。',
    photos: [
      { label: '手作过程' },
      { label: '小组合影', group: true },
    ],
    saveState: '已自动保存',

    children: [
      { name: '陈小明', checked: true },
      { name: '李雨萱', checked: true },
      { name: '张力轩', checked: true },
      { name: '王子涵', checked: true },
      { name: '赵佳怡', checked: true },
      { name: '刘浩然', checked: true },
      { name: '周睿阳', checked: false },
      { name: '何思琪', checked: true },
    ],
    selectedCount: 7,
    rate: 88,
  },

  onUnload() {
    clearTimeout(this.saveTimer);
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
    this.autoSave();
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
    this.autoSave();
  },

  onToggleChild(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.setData({ [`children[${i}].checked`]: !this.data.children[i].checked });
    this.syncSelected();
    this.autoSave();
  },

  syncSelected() {
    const total = this.data.children.length;
    const selectedCount = this.data.children.filter((c) => c.checked).length;
    this.setData({ selectedCount, rate: Math.round((selectedCount / total) * 100) });
  },

  autoSave() {
    this.setData({ saveState: '保存中…' });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.setData({ saveState: '已自动保存' }), AUTOSAVE_DELAY);
  },

  onAddPhoto() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: (res) => {
        const added = res.tempFiles.map((_, i) => ({ label: `新照片 ${this.data.photos.length + i + 1}` }));
        this.setData({ photos: this.data.photos.concat(added) });
        this.autoSave();
      },
    });
  },

  onPublish() {
    const title = this.data.title.trim();
    const content = this.data.content.trim();
    const selected = this.data.children.filter((c) => c.checked).length;
    const photoCount = this.data.photos.length;

    if (!title || !selected || (!content && !photoCount)) {
      this.setData({ saveState: '发布前须填写标题、至少关联一名幼儿，并提供评语或照片' });
      return;
    }
    this.setData({ saveState: '已由教师确认内容并发布；不另送微信机审' });
  },
});
