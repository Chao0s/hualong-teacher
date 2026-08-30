/**
 * 底部导航 —— 原型每页都复制一份 `.tabs`，这里抽成组件，5 个页面共用。
 *
 * 不用小程序原生 tabBar：原生 tabBar 只收 PNG 图标，不收 SVG。
 */

// 已经转成小程序的 Tab。没转的点了弹提示，不会白屏。
const ROUTES = {
  home: '/pages/home/index',
  party: '/pages/school-affairs/index',
  coord: '/pages/comprehensive-coordination/index',
  training: '/pages/training-center/index',
  family: '/pages/home-school/index',
};

Component({
  properties: {
    // 当前高亮哪一个，取值见 tabs 里的 key
    active: { type: String, value: '' },
  },

  data: {
    tabs: [
      { key: 'home', label: '首页' },
      { key: 'party', label: '党建管理' },
      { key: 'coord', label: '综合协调' },
      { key: 'training', label: '教研培训' },
      { key: 'family', label: '家园社共育' },
    ],
  },

  methods: {
    onTap(e) {
      const key = e.currentTarget.dataset.key;
      if (key === this.data.active) return;

      const url = ROUTES[key];
      if (url) {
        // Tab 之间是平级切换，用 reLaunch 清掉页面栈，避免返回栈越堆越深
        wx.reLaunch({ url });
        return;
      }
      const tab = this.data.tabs.find((t) => t.key === key);
      wx.showToast({ title: `${tab.label}（预览工程未接入）`, icon: 'none' });
    },
  },
});
