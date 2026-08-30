/**
 * 资源库 —— 原型 screens/resource-library.html 的小程序版本。
 *
 * 筛选口径照抄原型脚本：分类命中 且 (搜索词为空 或 名称/分类包含搜索词)。
 * 计数文案也照抄：全部时是「N 个资源」，选了分类是「衣 · N 个」。
 */

const ENTRIES = [
  { name: '香云纱纹样', tag: '衣', icon: 'silk', tone: 'green' },
  { name: '广绣小包', tag: '衣', icon: 'embroidery', tone: 'green' },
  { name: '双皮奶', tag: '食', icon: 'milk', tone: 'amber' },
  { name: '荔枝蜜', tag: '食', icon: 'honey', tone: 'amber' },
  { name: '留耕堂', tag: '住', icon: 'hall', tone: 'accent' },
  { name: '沙湾古镇', tag: '住', icon: 'town', tone: 'green' },
  { name: '龙舟竞渡', tag: '行', icon: 'boat', tone: 'amber' },
  { name: '安全过街', tag: '行', icon: 'crossing', tone: 'blue' },
  { name: '粤语童谣', tag: '艺', icon: 'song', tone: 'blue' },
  { name: '醒狮纹样', tag: '艺', icon: 'lion', tone: 'green' },
  { name: '粤剧身段', tag: '艺', icon: 'opera', tone: 'blue' },
  { name: '陶艺纹饰', tag: '艺', icon: 'pottery', tone: 'accent' },
];

Page({
  data: {
    tags: ['all', '衣', '食', '住', '行', '艺'],
    activeTag: 'all',
    query: '',
    visible: ENTRIES,
    countText: '',
  },

  /** 从课程资源页搜索跳过来时带着 q 参数，原型也是这么传的。 */
  onLoad(options) {
    this.setData({ query: options.q ? decodeURIComponent(options.q) : '' });
    this.applyFilter();
  },

  onTagTap(e) {
    this.setData({ activeTag: e.currentTarget.dataset.tag });
    this.applyFilter();
  },

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
    this.applyFilter();
  },

  applyFilter() {
    const tag = this.data.activeTag;
    const query = this.data.query.trim().toLowerCase();
    const visible = ENTRIES.filter((entry) => {
      const tagMatch = tag === 'all' || entry.tag === tag;
      const textMatch = !query || entry.name.toLowerCase().includes(query) || entry.tag.includes(query);
      return tagMatch && textMatch;
    });
    this.setData({
      visible,
      countText: tag === 'all' ? `${visible.length} 个资源` : `${tag} · ${visible.length} 个`,
    });
  },

  onEntryTap() {
    wx.navigateTo({ url: '/pages/resource-detail/index' });
  },
});
