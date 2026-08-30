/**
 * 在园时光管理 —— 原型 screens/growth-book-time-manage.html 的小程序版本。
 *
 * 主题排序、归类、改名与删除的口径全部走 utils/growth-book.js，一条都没在本页重写。
 *
 * 三处网页写法换成小程序写法：
 *   1. 每次改动重画 innerHTML → data 里存一份算好的列表；
 *   2. <select> → <picker mode="selector">，选项换一批就回到「选择主题」，和原型重画后一样；
 *   3. 勾选框自己画 —— 原生 checkbox 的样式不好改。
 *
 * 勾选单条只刷新那一行的选中态，不整页重算，这样目标主题不会被顺手清掉；
 * 「全选结果」在原型里就是整页重算，照搬。
 */

const {
  materialDateValue,
  orderedTimeTopics,
  readBookConfig,
  writeBookConfig,
} = require('../../utils/growth-book.js');

const ACTIVITY_NAMES = [
  '认识我们的新教室', '晨间自主游戏', '第一次值日', '搭建我们的幼儿园', '彩色树叶拓印', '寻找春天的颜色', '种子的秘密', '给小苗浇水',
  '春风里的纸飞机', '花园昆虫观察', '雨后的水洼', '小小天气播报员', '户外平衡挑战', '沙池里的城堡', '轮胎滚滚乐', '合作运球',
  '绘本里的春天', '故事角色表演', '我会整理图书', '有趣的影子', '声音从哪里来', '磁铁好朋友', '沉与浮小实验', '泡泡变变变',
  '蔬菜印章画', '黏土里的小动物', '音乐节奏游戏', '彩带舞起来', '春日野餐会', '安全过马路', '消防疏散练习', '保护牙齿',
  '爱眼小课堂', '我会自己穿衣', '午餐小帮手', '安静午睡日', '认识端午节', '一起包粽子', '端午香包', '龙舟接力赛',
  '夏天的味道', '寻找校园里的圆', '水枪运水赛', '毕业班来做客', '班级植物观察', '纸箱创意搭建', '小小分享会', '学期作品展',
];

function demoActivities() {
  const start = new Date('2026-02-24T00:00:00');
  return ACTIVITY_NAMES.map((title, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index * 3);
    return {
      id: `demo-time-${String(index + 1).padStart(2, '0')}`,
      title,
      date: `${date.getMonth() + 1}月${date.getDate()}日`,
      dateValue: date.toISOString().slice(0, 10),
      photos: [`${title}照片1`, `${title}照片2`],
      description: `孩子们在${title}中认真观察、主动表达，并记录了自己的发现。`,
      topicId: index < 4 ? 'p1' : index < 8 ? 'p2' : null,
    };
  });
}

const byNewest = (a, b) => materialDateValue(b) - materialDateValue(a);
const byOldest = (a, b) => materialDateValue(a) - materialDateValue(b);

Page({
  data: {
    topicCount: 0,
    activityCount: 0,
    ungroupedCount: 0,
    topics: [],
    ungrouped: [],
    newTopicName: '',
    query: '',
    selectedCount: 0,
    targetOptions: ['选择主题'],
    targetIndex: 0,
    assignDisabled: true,
    locked: false,
  },

  onLoad() {
    const config = readBookConfig();
    config.timeTopics = config.timeTopics && config.timeTopics.length ? config.timeTopics : [
      { id: 'p1', title: '春天来了', sort: 1 },
      { id: 'p2', title: '一起划龙舟', sort: 2 },
    ];
    if ((config.timeMaterialDemoVersion || 0) < 2) {
      const byId = new Map((config.material || []).map((item) => [item.id, item]));
      demoActivities().forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, item); });
      config.material = Array.from(byId.values());
      config.timeMaterialInitialized = true;
      config.timeMaterialDemoVersion = 2;
      writeBookConfig(config);
    }
    this.config = config;
    this.selected = new Set();
    this.editingTopicId = null;
    this.editTitle = '';
    this.pendingRemoveId = null;
    this.targetIds = [''];
    this.render();
  },

  locked() {
    return this.config.compilationStatus === 'e2';
  },

  render() {
    const config = this.config;
    const topics = orderedTimeTopics(config.timeTopics, config.material);

    const looseIds = new Set(config.material.filter((item) => !item.topicId).map((item) => item.id));
    [...this.selected].forEach((id) => { if (!looseIds.has(id)) this.selected.delete(id); });

    const query = this.data.query.trim().toLowerCase();
    const visible = config.material
      .filter((item) => !item.topicId && (!query || item.title.toLowerCase().includes(query)))
      .sort(byNewest);

    this.targetIds = ['', ...topics.map((topic) => topic.id)];

    this.setData({
      topics: topics.map((topic) => {
        const items = config.material.filter((item) => item.topicId === topic.id).sort(byOldest);
        return {
          id: topic.id,
          title: topic.title,
          count: items.length,
          editing: this.editingTopicId === topic.id,
          editTitle: this.editingTopicId === topic.id ? this.editTitle : '',
          items: items.map((item) => ({ id: item.id, title: item.title, date: item.date })),
        };
      }),
      ungrouped: visible.map((item) => ({
        id: item.id,
        title: item.title,
        date: item.date,
        checked: this.selected.has(item.id),
        pending: this.pendingRemoveId === item.id,
      })),
      topicCount: topics.length,
      activityCount: config.material.length,
      ungroupedCount: looseIds.size,
      selectedCount: this.selected.size,
      /* 原型重画 <select> 后选中项回到第一个，照搬 */
      targetOptions: ['选择主题', ...topics.map((topic) => topic.title)],
      targetIndex: 0,
      assignDisabled: this.locked() || !this.selected.size,
      locked: this.locked(),
    });
  },

  save(message) {
    writeBookConfig(this.config);
    this.render();
    wx.showToast({ title: message, icon: 'none' });
  },

  /* ---------- 未归类素材 ---------- */

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
    this.render();
  },

  onSelectAll() {
    if (this.locked()) return;
    const visible = this.data.ungrouped;
    const allSelected = visible.length && visible.every((row) => this.selected.has(row.id));
    visible.forEach((row) => {
      if (allSelected) this.selected.delete(row.id);
      else this.selected.add(row.id);
    });
    this.render();
  },

  onPick(e) {
    if (this.locked()) return;
    const i = Number(e.currentTarget.dataset.index);
    const { id } = this.data.ungrouped[i];
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.setData({
      [`ungrouped[${i}].checked`]: this.selected.has(id),
      selectedCount: this.selected.size,
      assignDisabled: !this.selected.size,
    });
  },

  onTargetChange(e) {
    this.setData({ targetIndex: Number(e.detail.value) });
  },

  onAssign() {
    if (this.data.assignDisabled) return;
    const topicId = this.targetIds[this.data.targetIndex];
    if (!topicId) {
      wx.showToast({ title: '请先选择主题', icon: 'none' });
      return;
    }
    this.config.material.forEach((item) => { if (this.selected.has(item.id)) item.topicId = topicId; });
    const count = this.selected.size;
    this.selected.clear();
    this.save(`已归入 ${count} 项活动`);
  },

  /* 删除要点两下：第一下把按钮换成「确认删除」，第二下才真删。原型不弹提示。 */
  onRemove(e) {
    if (this.locked()) return;
    const { id } = e.currentTarget.dataset;
    if (this.pendingRemoveId !== id) {
      this.pendingRemoveId = id;
      this.render();
      return;
    }
    this.config.material = this.config.material.filter((item) => item.id !== id);
    this.selected.delete(id);
    this.pendingRemoveId = null;
    writeBookConfig(this.config);
    this.render();
  },

  /* ---------- 主题 ---------- */

  onNewTopicInput(e) {
    this.setData({ newTopicName: e.detail.value });
  },

  onCreateTopic() {
    if (this.locked()) return;
    const title = this.data.newTopicName.trim();
    if (!title) {
      wx.showToast({ title: '请输入主题名称', icon: 'none' });
      return;
    }
    if (this.config.timeTopics.some((item) => item.title === title)) {
      wx.showToast({ title: '已经有同名主题', icon: 'none' });
      return;
    }
    this.config.timeTopics.push({
      id: `p${Date.now()}`,
      title,
      sort: this.config.timeTopics.length + 1,
    });
    this.setData({ newTopicName: '' });
    this.save('主题已新建');
  },

  onRename(e) {
    if (this.locked()) return;
    const topic = this.data.topics[Number(e.currentTarget.dataset.index)];
    this.editingTopicId = topic.id;
    this.editTitle = topic.title;
    this.render();
  },

  onEditTitleInput(e) {
    this.editTitle = e.detail.value;
  },

  onCancelRename() {
    this.editingTopicId = null;
    this.render();
  },

  onSaveRename(e) {
    if (this.locked()) return;
    const topicId = this.data.topics[Number(e.currentTarget.dataset.index)].id;
    const topic = this.config.timeTopics.find((item) => item.id === topicId);
    const title = this.editTitle.trim();
    if (!topic) return;
    if (!title) {
      wx.showToast({ title: '请输入主题名称', icon: 'none' });
      return;
    }
    if (this.config.timeTopics.some((item) => item.id !== topicId && item.title === title)) {
      wx.showToast({ title: '已经有同名主题', icon: 'none' });
      return;
    }
    topic.title = title;
    this.editingTopicId = null;
    this.save('主题已更新');
  },

  onDeleteTopic(e) {
    if (this.locked()) return;
    const { id } = e.currentTarget.dataset;
    const topic = this.config.timeTopics.find((item) => item.id === id);
    if (!topic) return;
    this.config.material.forEach((item) => { if (item.topicId === topic.id) item.topicId = null; });
    this.config.timeTopics = this.config.timeTopics.filter((item) => item.id !== topic.id);
    this.editingTopicId = null;
    this.save('主题已删除');
  },

  onUndo(e) {
    if (this.locked()) return;
    const material = this.config.material.find((item) => item.id === e.currentTarget.dataset.id);
    if (!material) return;
    material.topicId = null;
    this.save('已撤销归类');
  },
});
