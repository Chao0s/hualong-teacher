/**
 * 填写学期评价 —— 原型 screens/teacher-term-form.html 的小程序版本。
 *
 * 和月度评价那页的相册几乎一样，两点不同（都照抄原型）：
 *   1. 相册按月分组全部显示，不按当前月份过滤。
 *   2. 每张照片的显示名和导入后的标签不同（显示「建构游戏」，标签是「3月建构」）。
 */

const CHILDREN = [
  { key: 'chen', name: '陈小明' },
  { key: 'li', name: '李雨萱' },
  { key: 'zhang', name: '张力轩' },
];

const ALBUM = [
  { title: '3月', photos: [{ label: '3月建构', text: '建构游戏' }, { label: '3月值日', text: '值日生体验' }] },
  { title: '4月', photos: [{ label: '4月阅读', text: '绘本阅读' }, { label: '4月春游', text: '春游远足' }] },
  { title: '5月', photos: [{ label: '5月运动会', text: '趣味运动会' }, { label: '5月种植角', text: '种植角观察' }] },
  { title: '6月', photos: [{ label: '6月手作', text: '端午手作' }, { label: '6月律动', text: '音乐律动' }] },
  { title: '7月', photos: [{ label: '7月戏水', text: '戏水活动' }, { label: '7月毕业', text: '毕业排练' }] },
];

Page({
  data: {
    children: CHILDREN.map((c) => c.name),
    childIndex: 0,
    content: '本学期能稳定参与班级活动，规则意识和表达意愿持续提升，建议继续鼓励其在家庭场景中承担小任务。',
    imported: [],

    albumOpen: false,
    albumTitle: '',
    groups: ALBUM,
    picked: [],
    confirmText: '导入',
  },

  onLoad(options) {
    if (options.child) {
      const i = CHILDREN.findIndex((c) => c.key === options.child);
      if (i > -1) this.setData({ childIndex: i });
    }
    if (options.view) wx.setNavigationBarTitle({ title: '学期评价详情' });
  },

  onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value) });
    if (this.data.albumOpen) this.syncTitle();
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onOpenAlbum() {
    this.setData({ albumOpen: true, picked: [], confirmText: '导入' });
    this.syncTitle();
  },

  syncTitle() {
    this.setData({ albumTitle: `${this.data.children[this.data.childIndex]}的月度评价相册` });
  },

  onTogglePhoto(e) {
    const label = e.currentTarget.dataset.label;
    const picked = this.data.picked.includes(label)
      ? this.data.picked.filter((x) => x !== label)
      : this.data.picked.concat(label);
    this.setData({ picked, confirmText: picked.length ? `导入（${picked.length}）` : '导入' });
  },

  onConfirmAlbum() {
    if (!this.data.picked.length) return;
    const imported = this.data.imported.slice();
    this.data.picked.forEach((label) => {
      if (!imported.includes(label)) imported.push(label);
    });
    this.setData({ imported, albumOpen: false, picked: [] });
  },

  onCloseAlbum() {
    this.setData({ albumOpen: false, picked: [] });
  },

  onRemoveImported(e) {
    const label = e.currentTarget.dataset.label;
    this.setData({ imported: this.data.imported.filter((x) => x !== label) });
  },

  onSave() {
    wx.showToast({ title: '已保存学期评价（预览工程不落库）', icon: 'none' });
  },
});
