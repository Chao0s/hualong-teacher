/**
 * 亲子任务 —— 数据来自 `GET /home-school/parent-tasks`。
 *
 * ── 草稿也在这一页 ─────────────────────────────────────────────────────────
 *
 * 契约：`publish_status=s1` 的草稿**只在这个端点出现，不进家长端任何列表**
 * （§4 规则 2）。所以这一页是教师唯一能找回自己草稿的地方 —— 草稿卡片带状态标签，
 * 点进去回到发布页继续改（`PATCH`，仅 s1 可改）。
 *
 * ── 卡片那一行 meta 只放有据可查的 ─────────────────────────────────────────
 *
 * 原型写的是「6月8日发布 · 28 人中 23 人完成」。两个数现在都是服务端的派生值
 * （`done_count`／`roster_count`，契约 v0.8 新增），分母与看板的行数是同一个集合。
 *
 * 但它**不是发布当时的名册快照**：发布后转入的幼儿计进分母且没有提交行，于是显示
 * 未完成。所以文案说的是「目前班级」，不说「当时的 28 人」。
 *
 * **草稿不显示完成率** —— 草稿一条提交行都不会有，`0/10 完成` 是一个必然的 0，
 * 显示它只会让人以为家长都没交。
 *
 * ── 原型那三种颜色的 mark 块 ───────────────────────────────────────────────
 *
 * 原型给四张卡片配了 green／amber／blue／无 四种色块，纯装饰，没有对应字段。
 * 这里改成跟着 `parent_task_type` 走：社区任务绿、日常任务无色 —— 与旁边的
 * type-pill 是同一个依据。**不保留那种按下标轮换的颜色**，它会让人以为在编码某种含义。
 */

const co = require('../../services/co-education');
const guard = require('../../utils/guard');

const PAGE_LIMIT = 20;

/** service 返回的值已经可以直接 setData，这里只补卡片自己的呈现字段。 */
function toCard(task) {
  return {
    ...task,
    glyph: task.community ? '社' : '日',
    tone: task.community ? 'green' : '',
    // 草稿看开始时间，发布过的看发布日 + 完成率。两种卡片的 meta 不是同一件事。
    meta: task.isDraft
      ? `未发布 · 开始 ${task.startLabel}`
      : `${task.publishedLabel} 发布 · ${task.doneLabel}`,
    /**
     * 跳转目标在这里算好，**不把布尔值塞进 dataset**。
     *
     * `data-draft="{{false}}"` 取回来可能是字符串 `"false"`，而那是一个真值 ——
     * 于是已发布的任务会被送进编辑页。算成一个 url 就没有这一类问题。
     *
     * 草稿回发布页接着改，发布过的进详情看完成情况：两页做的事不同，草稿要的是
     * 编辑表单，发布过的任务正文已永久唯读（F16），详情给的是看板与「结束任务」。
     */
    url: task.isDraft
      ? `/pages/parent-task-publish/index?id=${task.id}`
      : `/pages/parent-task-detail/index?id=${task.id}`,
  };
}

Page({
  data: {
    tasks: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: '',
  },

  onLoad() {
    this.load();
  },

  /** 从发布页或详情页返回时重取：草稿刚建好、任务刚发布或刚结束，列表要跟上。 */
  onShow() {
    if (!this.data.loading) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await guard.requireSession();
      const page = await co.listTasks({ limit: PAGE_LIMIT });
      this.setData({
        tasks: page.items.map(toCard),
        nextCursor: page.nextCursor,
        loading: false,
      });
    } catch (err) {
      if (guard.endSessionOnAuthFailure(err)) return;
      this.setData({
        loading: false,
        tasks: [],
        error: err.userMessage || '任务加载失败，请稍后重试',
      });
    }
  },

  /** 游标为空是结束的唯一信号（契约 §3.1）。 */
  async onReachBottom() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const page = await co.listTasks({ cursor: this.data.nextCursor, limit: PAGE_LIMIT });
      this.setData({
        tasks: this.data.tasks.concat(page.items.map(toCard)),
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (err) {
      this.setData({ loadingMore: false });
      if (guard.endSessionOnAuthFailure(err)) return;
      wx.showToast({ title: err.userMessage || '加载更多失败', icon: 'none' });
    }
  },

  onRetry() {
    this.load();
  },

  onPublish() {
    wx.navigateTo({ url: '/pages/parent-task-publish/index' });
  },

  onTaskTap(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  },
});
