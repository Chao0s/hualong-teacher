/**
 * 填写月度评价 —— 原型 screens/teacher-monthly-form.html 的小程序版本。
 *
 * 相册按当前月份过滤分组；换月或关掉浮层都会清空已勾选，照抄原型的 syncAlbum/closeSheet。
 * 导入时同名照片不重复加。
 *
 * 从月度评价表点圆点过来会带 ?child=&month=&view=1；这里读 child 和 month 定位，
 * view 只影响标题（原型也只是换个入口，表单本身没有只读态）。
 */

const CHILDREN = [
  { key: 'chen', name: '陈小明' },
  { key: 'li', name: '李雨萱' },
  { key: 'zhang', name: '张力轩' },
];

const MONTHS = [
  { value: 3, label: '3月' },
  { value: 4, label: '4月' },
  { value: 5, label: '5月' },
  { value: 6, label: '6月' },
  { value: 7, label: '7月' },
];

// 相册按月分周，照抄原型的九个分组
const ALBUM = [
  { month: 3, title: '第2周', photos: ['晨间锻炼', '搭建游戏'] },
  { month: 3, title: '第4周', photos: ['春芽观察', '故事表演'] },
  { month: 4, title: '第1周', photos: ['绘本阅读', '春游远足'] },
  { month: 4, title: '第3周', photos: ['泥工坊', '跳绳练习'] },
  { month: 5, title: '第2周', photos: ['趣味运动会', '种植角观察'] },
  { month: 5, title: '第4周', photos: ['科学角', '音乐游戏'] },
  { month: 6, title: '第1周', photos: ['端午手作', '绘本共读'] },
  { month: 6, title: '第2周', photos: ['区域游戏', '户外运动'] },
  { month: 7, title: '第1周', photos: ['戏水活动', '毕业排练'] },
];

Page({
  data: {
    months: MONTHS,
    monthIndex: 3,
    children: CHILDREN.map((c) => c.name),
    childIndex: 0,
    content: '本月在集体活动中愿意主动表达，能与同伴协商材料使用，整理习惯有明显进步。',
    imported: [],

    albumOpen: false,
    albumTitle: '',
    visibleGroups: [],
    picked: [],
    confirmText: '导入',
  },

  onLoad(options) {
    const patch = {};
    if (options.child) {
      const i = CHILDREN.findIndex((c) => c.key === options.child);
      if (i > -1) patch.childIndex = i;
    }
    if (options.month) {
      const i = MONTHS.findIndex((m) => String(m.value) === options.month);
      if (i > -1) patch.monthIndex = i;
    }
    this.setData(patch);
    if (options.view) wx.setNavigationBarTitle({ title: '月度评价详情' });
  },

  onMonthChange(e) {
    this.setData({ monthIndex: Number(e.detail.value), picked: [] });
    if (this.data.albumOpen) this.syncAlbum();
  },

  onChildChange(e) {
    this.setData({ childIndex: Number(e.detail.value) });
    if (this.data.albumOpen) this.syncAlbum();
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  /* ── 相册 ──────────────────────────────────────────────────────────── */

  onOpenAlbum() {
    this.setData({ albumOpen: true, picked: [] });
    this.syncAlbum();
  },

  syncAlbum() {
    const month = MONTHS[this.data.monthIndex].value;
    this.setData({
      albumTitle: `${this.data.children[this.data.childIndex]}的在园时光相册（${month}月）`,
      visibleGroups: ALBUM.filter((g) => g.month === month),
      confirmText: this.data.picked.length ? `导入（${this.data.picked.length}）` : '导入',
    });
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
    wx.showToast({ title: '已保存评价（预览工程不落库）', icon: 'none' });
  },
});
