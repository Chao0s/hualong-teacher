/**
 * 社区共育 —— 原型 screens/community-coeducation.html 的小程序版本。
 *
 * 「加入成长册」写的是成长册配置里的 material 数组（键 hualong.growth-book.v1），
 * 和「全部活动」那一页是同一条通道，所以两边的收录状态互相可见。
 * 那套配置由 33 KB 的 growth-book-render.js 管着，这里同样只读整个对象、
 * 改 material、写回，其余字段不碰。
 *
 * 和「全部活动」不同的是：这一页没有选照片的浮层，点一下就把该条的全部照片收进去，
 * 再点一下整条移出，照抄原型。
 */

const BOOK_STORE_KEY = 'hualong.growth-book.v1';

const POSTS = [
  {
    id: 'c1', initial: '陈', tone: '', author: '陈小明家长', time: '今天 09:18',
    time_key: 'week', type: 'community', typeLabel: '社区任务', task: '社区建筑里的纹样',
    text: '小明在祠堂门口找到木雕花纹，说“像衣服上的花边”。我们一起数了屋檐上的图案，并拍下他最喜欢的一处。',
    photos: ['门楼', '木雕', '记录'],
  },
  {
    id: 'c2', initial: '李', tone: 'green', author: '李雨萱家长', time: '昨天 18:42',
    time_key: 'week', type: 'daily', typeLabel: '日常任务', task: '我会安全过街',
    text: '从幼儿园到公交站，我们让孩子标记红绿灯、斑马线和需要牵手的位置。她能主动提醒大人“这里要等绿灯”。',
    photos: ['路线图', '过街点'],
  },
  {
    id: 'c3', initial: '张', tone: 'amber', author: '张力轩家长', time: '6月18日',
    time_key: 'month', type: 'community', typeLabel: '社区任务', task: '社区里的食物来源',
    text: '孩子观察了鱼档和蔬菜档，能说出“先问价格再付款”。回家后用图画记录了买菜流程。',
    photos: ['鱼档', '蔬菜', '流程画'],
  },
  {
    id: 'c4', initial: '王', tone: 'blue', author: '王子涵家长', time: '6月6日',
    time_key: 'older', type: 'community', typeLabel: '社区任务', task: '社区建筑里的纹样',
    text: '子涵注意到祠堂前的石阶很高，会比较“以前的人和现在的小朋友走路有什么不一样”。我们补充了关于礼仪空间的讨论。',
    photos: ['石阶', '合照'],
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
    timeOptions: [
      { key: 'all', label: '全部时间' },
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'older', label: '更早' },
    ],
    timeIndex: 0,
    typeOptions: [
      { key: 'all', label: '全部任务' },
      { key: 'daily', label: '日常任务' },
      { key: 'community', label: '社区任务' },
    ],
    typeIndex: 0,
    visible: [],
  },

  onShow() {
    this.refresh();
  },

  onTimeChange(e) {
    this.setData({ timeIndex: Number(e.detail.value) });
    this.refresh();
  },

  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) });
    this.refresh();
  },

  refresh() {
    const time = this.data.timeOptions[this.data.timeIndex].key;
    const type = this.data.typeOptions[this.data.typeIndex].key;
    const material = readBook().material || [];

    const visible = POSTS
      .filter((post) => (time === 'all' || post.time_key === time) && (type === 'all' || post.type === type))
      .map((post) => ({ ...post, added: material.some((row) => row.id === post.id) }));

    this.setData({ visible });
  },

  onToggleMaterial(e) {
    const post = this.data.visible[Number(e.currentTarget.dataset.index)];
    const config = readBook();
    const added = (config.material || []).some((row) => row.id === post.id);

    config.material = (config.material || []).filter((row) => row.id !== post.id);
    if (added) {
      wx.showToast({ title: '已移出成长册', icon: 'none' });
    } else {
      config.material.push({
        id: post.id,
        title: `${post.task}（${post.author}）`,
        date: post.time,
        photos: post.photos,
      });
      wx.showToast({ title: `已加入成长册（${post.photos.length} 张照片）`, icon: 'none' });
    }
    writeBook(config);
    this.refresh();
  },
});
