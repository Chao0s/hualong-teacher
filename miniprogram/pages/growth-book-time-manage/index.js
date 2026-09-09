/**
 * 在园时光管理（家园社共育 → 成长档案 → 成长册 → 在园时光管理）。
 *
 * **交互照 `decision.md` 2026-08-13 的六轮评审，一处没改；换掉的只是数据源。**
 * 这一页以前读写 `wx.setStorageSync`，主题与活动都是本地造的假数据；现在读写
 * `services/growth-book.js`，也就是 G68（在园时光与社区投稿的入册通道有表有数据、
 * 零 API 面）这一轮补上的那 8 条端点。
 *
 * decision.md 定死、本页照做的六条：
 *   主题顺序     按各主题内最早活动日期升序（第六轮）。**这个顺序服务端算好再回**，
 *                本页拿到什么顺序就画什么顺序，不重排
 *   删除两段确认 未归类素材的不可恢复删除是同一个按钮两段确认「删除 → 确认删除」，
 *                不调宿主会拦截的原生弹窗（第六轮）
 *   删主题直接做 删除主题等同集体撤销归类，素材全部回到未归类清单、不移出成长册，
 *                所以**不做二次确认**（第五轮）
 *   撤销 ≠ 删除  主题内素材只提供「撤销」，回到下方清单可重新归类；下方素材行只提供
 *                「删除」，删掉即解除本学期入册关系且不提供撤销
 *   没有行内下拉 不提供行内主题下拉，也不提供手动上移／下移
 *   主题名用输入 新建与重命名都用页面内的文字栏，不依赖 `prompt`
 *
 * 三处网页写法仍是小程序写法：改动后重画整段 data 而不是 innerHTML；`<select>` 换
 * `<picker mode="selector">`，选项换一批就回到「选择主题」；勾选框自己画。
 *
 * ── 「搜索」在本地做，因为整份结果就在手上 ─────────────────────────────────
 *
 * `GET /teacher/growth-book/materials` 是名册型整取、不分页（§3.5），所以「搜索」与
 * 「全选当前结果」都在这一份完整清单上做。**这正是那条端点不分页的理由**：翻到一半
 * 的全选会静默漏掉没翻到的那几笔。搜索不发请求，契约也没有这个查询参数。
 *
 * ── 每次写入之后整页重取 ───────────────────────────────────────────────────
 *
 * 主题顺序是服务端从「该主题全部活动的最早来源日期」派生的，所以**归类一批素材会改
 * 主题的顺序**。本地改一份副本再拼回去就会与服务端的顺序漂开，而管理页、正文与 TOC
 * 必须共用同一个顺序。整页重取一次比自己算便宜，也不会算错。
 *
 * ── 进来时不知道编册锁没锁 ─────────────────────────────────────────────────
 *
 * 这一族没有一条端点读得到 `compilation_status`（`services/growth-book.js` 的头注写了
 * 为什么不顺手调 `POST /teacher/growth-book/compilation`）。所以 `locked` 从 false 起，
 * 第一次写入被服务端以 `compilation_locked` 拒掉时才翻成 true，然后收起全部写入控件。
 * **界面从来不是边界**：服务端每一条 SQL 都内联了 `compilation_status='e1'`。
 */

const bookApi = require('../../services/growth-book.js');

Page({
  data: {
    loading: true,
    error: '',
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
    lockedText: '',
  },

  onLoad() {
    this.selected = new Set();
    this.editingTopicId = null;
    this.editTitle = '';
    this.pendingRemoveId = null;
    this.targetIds = [''];
    this.book = { topics: [], ungrouped: [], topicCount: 0, activityCount: 0, ungroupedCount: 0 };
    this.reload();
  },

  /** 服务端那一份是唯一的真相。每次写入之后重取，不在本地拼一份。 */
  async reload() {
    this.setData({ loading: true, error: '' });
    try {
      this.book = await bookApi.loadTimeManage();
      this.setData({ loading: false });
      this.render();
    } catch (err) {
      // 本页没有开 `enablePullDownRefresh`，全仓库也没有一页开过，所以出路只有旁边
      // 那颗「重试」。文案不写「下拉」——写了就是叫教师做一个做不到的动作。
      this.setData({ loading: false, error: err.userMessage || '加载失败，请点「重试」' });
    }
  },

  /** 取数失败之后唯一的出路。没有它，一次网络抖动就把整页钉死在错误文案上。 */
  onRetry() {
    this.reload();
  },

  /**
   * 把手上那一份画出来。
   *
   * 勾选状态与两段确认是本页的临时状态，重取之后按 id 对一遍：清单里已经没有的 id
   * 一律丢掉，否则一个刚被删掉的 id 会一直算在「已选 N 项」里。
   */
  render() {
    const book = this.book;
    const looseIds = new Set(book.ungrouped.map((item) => item.id));
    [...this.selected].forEach((id) => { if (!looseIds.has(id)) this.selected.delete(id); });
    if (this.pendingRemoveId !== null && !looseIds.has(this.pendingRemoveId)) this.pendingRemoveId = null;

    const query = this.data.query.trim().toLowerCase();
    const visible = book.ungrouped.filter((item) => !query || item.title.toLowerCase().includes(query));

    this.targetIds = ['', ...book.topics.map((topic) => topic.id)];

    this.setData({
      topics: book.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        count: topic.count,
        editing: this.editingTopicId === topic.id,
        editTitle: this.editingTopicId === topic.id ? this.editTitle : '',
        items: topic.items.map((item) => ({ id: item.id, title: item.title, date: item.dateLabel })),
      })),
      ungrouped: visible.map((item) => ({
        id: item.id,
        title: item.title,
        date: item.dateLabel,
        checked: this.selected.has(item.id),
        pending: this.pendingRemoveId === item.id,
      })),
      topicCount: book.topicCount,
      activityCount: book.activityCount,
      ungroupedCount: book.ungroupedCount,
      selectedCount: this.selected.size,
      /* 原型重画 <select> 后选中项回到第一个，照搬 */
      targetOptions: ['选择主题', ...book.topics.map((topic) => topic.title)],
      targetIndex: 0,
      assignDisabled: this.data.locked || !this.selected.size,
    });
  },

  /**
   * 一次写入失败之后要说的话与要做的事。
   *
   * `compilation_locked` 是一次性的坏消息：编册 `e2` 之后单向永久唯读，所以收起全部
   * 写入控件，不让教师再点一次去撞同一堵墙。其余的拒绝都只提示一句、重取一次 ——
   * 「有素材刚被别处改动」这一类，刷新之后就对了。
   */
  refuse(err) {
    const text = bookApi.actionFailureText(err);
    if (bookApi.isCompilationLocked(err)) {
      this.setData({ locked: true, lockedText: text, assignDisabled: true });
    }
    wx.showToast({ title: text, icon: 'none' });
    return this.reload();
  },

  /** 写入成功之后：报一句、重取一次。 */
  done(message) {
    wx.showToast({ title: message, icon: 'none' });
    return this.reload();
  },

  /* ---------- 未归类素材 ---------- */

  onQueryInput(e) {
    this.setData({ query: e.detail.value });
    this.render();
  },

  onSelectAll() {
    if (this.data.locked) return;
    const visible = this.data.ungrouped;
    const allSelected = visible.length && visible.every((row) => this.selected.has(row.id));
    visible.forEach((row) => {
      if (allSelected) this.selected.delete(row.id);
      else this.selected.add(row.id);
    });
    this.render();
  },

  /* 勾选单条只刷新那一行，不整页重算，这样目标主题不会被顺手清掉。 */
  onPick(e) {
    if (this.data.locked) return;
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

  async onAssign() {
    if (this.data.assignDisabled) return;
    const topicId = this.targetIds[this.data.targetIndex];
    if (!topicId) {
      wx.showToast({ title: '请先选择主题', icon: 'none' });
      return;
    }
    const ids = [...this.selected];
    try {
      await bookApi.assignTopic(ids, topicId);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    this.selected.clear();
    await this.done(`已归入 ${ids.length} 项活动`);
  },

  /**
   * 删除要点两下：第一下把按钮换成「确认删除」，第二下才真删。
   *
   * 这一下解除本学期入册关系、不可恢复，但**不动来源在园时光**（F19 §七）。
   * 两段确认是本页的事，服务端不认第二次点击。
   */
  async onRemove(e) {
    if (this.data.locked) return;
    const id = Number(e.currentTarget.dataset.id);
    if (this.pendingRemoveId !== id) {
      this.pendingRemoveId = id;
      this.render();
      return;
    }
    this.pendingRemoveId = null;
    try {
      await bookApi.removeMaterial(id);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    this.selected.delete(id);
    await this.done('已移出本学期成长册');
  },

  /* ---------- 主题 ---------- */

  onNewTopicInput(e) {
    this.setData({ newTopicName: e.detail.value });
  },

  async onCreateTopic() {
    if (this.data.locked) return;
    const title = this.data.newTopicName.trim();
    const why = bookApi.whyCannotNameTopic(title, this.book.topics, null);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    try {
      await bookApi.createTopic(title);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    this.setData({ newTopicName: '' });
    await this.done('主题已新建');
  },

  onRename(e) {
    if (this.data.locked) return;
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

  async onSaveRename(e) {
    if (this.data.locked) return;
    const topicId = this.data.topics[Number(e.currentTarget.dataset.index)].id;
    const title = this.editTitle.trim();
    const why = bookApi.whyCannotNameTopic(title, this.book.topics, topicId);
    if (why) {
      wx.showToast({ title: why, icon: 'none' });
      return;
    }
    try {
      await bookApi.renameTopic(topicId, title);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    this.editingTopicId = null;
    await this.done('主题已更新');
  },

  /* 删除主题等同集体撤销归类，素材全部回到下方清单，所以不做二次确认。 */
  async onDeleteTopic(e) {
    if (this.data.locked) return;
    const id = Number(e.currentTarget.dataset.id);
    try {
      await bookApi.deleteTopic(id);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    this.editingTopicId = null;
    await this.done('主题已删除');
  },

  /* 撤销归类走的是归类那一条 PATCH，`time_topic_id` 传 null，名单只放这一条。 */
  async onUndo(e) {
    if (this.data.locked) return;
    const id = Number(e.currentTarget.dataset.id);
    try {
      await bookApi.assignTopic([id], null);
    } catch (err) {
      await this.refuse(err);
      return;
    }
    await this.done('已撤销归类');
  },
});
