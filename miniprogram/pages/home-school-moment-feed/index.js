/**
 * 全部活动 —— 原型 screens/home-school-moment-feed.html 的小程序版本。
 *
 * 收录状态存在成长册的配置里（原型的 growth-book-render.js，键 hualong.growth-book.v1）。
 * 那个模块 33 KB，管着整本成长册；这一页只动其中的 material 数组，
 * 所以这里只做「读整个对象 → 改 material → 写回」，其余字段一律不碰。
 * 等成长册那批页面转过来时，再换成共用模块。
 *
 * 交互照抄原型：
 *   点按钮开浮层，已收录的标题变「调整收录照片」
 *   一张都不选时确认按钮变「移出成长资料」，确认即从 material 里删掉这条
 */

const BOOK_STORE_KEY = 'hualong.growth-book.v1';

const MOMENTS = [
  {
    id: 'm1', tone: '', title: '端午手作：艾草香囊', time: '今天 10:20', date: '6月12日',
    text: '孩子们自己选择艾草、棉布和配绳，能在同伴需要帮助时主动递材料，完成后愿意介绍自己的香囊。',
    photos: ['穿绳', '装袋', '合影', '选材', '展示'],
    preview: ['穿绳', '装袋', '合影'],
    meta: '涉及 24/28 人 · 18 位家长已查看',
  },
  {
    id: 'm2', tone: 'green', title: '户外运动：平衡木挑战', time: '6月10日', date: '6月10日',
    text: '多数孩子能连续完成平衡木行走，部分幼儿会主动提醒同伴张开手臂保持身体稳定。',
    photos: ['排队等待', '完成挑战', '加油', '合影'],
    preview: ['排队等待', '完成挑战'],
    meta: '涉及 26/28 人 · 22 位家长已查看',
  },
  {
    id: 'm3', tone: 'amber', title: '区域游戏：小小建筑师', time: '6月7日', date: '6月7日',
    text: '幼儿先画设计图再动手搭建，遇到结构倒塌时能调整底座宽度，愿意向同伴解释自己的想法。',
    photos: ['设计图', '搭建中', '成品', '讨论', '分享'],
    preview: ['设计图', '搭建中', '成品'],
    meta: '涉及 22/28 人 · 20 位家长已查看',
  },
];

function readBook() {
  try {
    const saved = wx.getStorageSync(BOOK_STORE_KEY);
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) {
    return {};
  }
}

function writeBook(config) {
  try {
    wx.setStorageSync(BOOK_STORE_KEY, config);
  } catch (e) {
    /* 存不进去就算了，和原型一样静默 */
  }
}

Page({
  data: {
    moments: MOMENTS.map((m) => ({ ...m, pickedCount: 0 })),
    picking: false,
    pickIndex: -1,
    pickTitle: '加入成长资料',
    pickPhotos: [],
    selected: [],
    confirmText: '加入',
  },

  onShow() {
    this.syncCards();
  },

  /** 每条动态显示当前收录了几张 */
  syncCards() {
    const material = readBook().material || [];
    const moments = MOMENTS.map((m) => {
      const hit = material.find((row) => row.id === m.id);
      return { ...m, pickedCount: hit ? hit.photos.length : 0 };
    });
    this.setData({ moments });
  },

  onOpenPick(e) {
    const index = Number(e.currentTarget.dataset.index);
    const moment = MOMENTS[index];
    const hit = (readBook().material || []).find((row) => row.id === moment.id);
    const selected = hit ? hit.photos.slice() : [];
    this.setData({
      picking: true,
      pickIndex: index,
      pickTitle: hit ? '调整收录照片' : '加入成长资料',
      pickPhotos: moment.photos,
      selected,
      confirmText: this.confirmTextFor(selected.length, !!hit),
    });
  },

  confirmTextFor(count, existed) {
    if (count) return `加入（${count}）`;
    return existed ? '移出成长资料' : '加入';
  },

  onTogglePhoto(e) {
    const label = e.currentTarget.dataset.label;
    const selected = this.data.selected.includes(label)
      ? this.data.selected.filter((x) => x !== label)
      : this.data.selected.concat(label);
    const existed = !!(readBook().material || []).find((row) => row.id === MOMENTS[this.data.pickIndex].id);
    this.setData({ selected, confirmText: this.confirmTextFor(selected.length, existed) });
  },

  onConfirmPick() {
    const moment = MOMENTS[this.data.pickIndex];
    const photos = this.data.selected;
    const config = readBook();

    config.material = (config.material || []).filter((row) => row.id !== moment.id);
    if (photos.length) {
      config.material.push({ id: moment.id, title: moment.title, date: moment.date, photos });
    }
    writeBook(config);

    this.setData({ picking: false });
    this.syncCards();
    wx.showToast({
      title: photos.length ? `已加入成长资料（${photos.length} 张照片）` : '已移出成长资料',
      icon: 'none',
    });
  },

  onClosePick() {
    this.setData({ picking: false, pickIndex: -1 });
  },
});
