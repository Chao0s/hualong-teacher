/**
 * 任务进度看板 — APP-STRUCTURE.md screen id `TaskBoard`.
 *
 * Read-only (ticket 10). The teacher's own tasks and where each one stands, so
 * "what do I do first" is answerable without opening anything.
 *
 * ── 版面：两节堆叠，不是筛选标签（2026-08-27 改回原型） ─────────────────────
 *
 * 原型 `teacher-tasks.html` 把当前与历史画成**两节堆叠**，每节标题右侧带一个计数
 * （「当前任务 2项」）。此前这一页做成了三枚筛选标签，理由是「游标分页没有总数，
 * 那个计数取不到」——**那个理由只否掉计数，不否掉版面**，而我把版面也一并换了。
 *
 * 现在两节都在，计数**只在这一节确实读完时才报**（`exhausted`）。没读完就不报数，
 * 而不是报一个「目前加载了几条」冒充总数 —— 契约 §3.1 不给总数正是因为那个数会与
 * 实际翻出来的页数不一致，客户端更不该自己造一个。
 */

const guard = require('../../utils/guard');
const task = require('../../services/task');
const { reportFailure } = require('../../utils/present');

// 原型的两节，次序即显示次序。
const SECTIONS = [
  { key: 'current', title: '当前任务' },
  { key: 'history', title: '历史任务' },
];

/** 一节的初始形状。两节各自翻页，所以游标与到底标记都是每节一份。 */
function emptySection(def) {
  return {
    key: def.key,
    title: def.title,
    items: [],
    cursor: null,
    exhausted: false,
    loading: true,
    // 读完才报数；没读完这一格是空串，不是一个冒充总数的数字。
    countLabel: '',
  };
}

Page({
  data: {
    ready: false,
    sections: SECTIONS.map(emptySection),
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    this.loadAll();
  },

  /**
   * 从详情或提交页返回时重读（票据 11）。onLoad 先于 onShow，所以第一次 onShow
   * 只做记号，不重复发一次请求。
   *
   * 两节一起重读：提交完成后那条任务要从「当前任务」消失、在「历史任务」出现，
   * 只重读一节看得见一半。
   */
  onShow() {
    if (!this.entered) {
      this.entered = true;
      return;
    }
    return this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  /** 两节同时读第一页。一节失败即整页报错：半张看板比一张空看板更容易误读。 */
  async loadAll() {
    this.setData({
      sections: SECTIONS.map(emptySection),
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });
    try {
      const pages = await Promise.all(
        SECTIONS.map((def) => task.listPage({ scope: def.key })),
      );
      this.setData({
        sections: SECTIONS.map((def, i) => this.settle(emptySection(def), pages[i])),
      });
    } catch (err) {
      reportFailure(this, err, {
        sections: SECTIONS.map((def) => ({ ...emptySection(def), loading: false })),
      });
    }
  },

  /** 把一页并进一节。`nextCursor` 为空是**结束的唯一信号**（DO-NOT-BUILD 11）。 */
  settle(section, page) {
    const items = section.items.concat(page.items);
    const exhausted = !page.nextCursor;
    return {
      ...section,
      items,
      cursor: page.nextCursor,
      exhausted,
      loading: false,
      countLabel: exhausted ? `${items.length}项` : '',
    };
  },

  /** 某一节的「加载更多」。只有那一节没读完时才画得出来。 */
  async onMoreTap(e) {
    const { key } = e.currentTarget.dataset;
    const index = this.data.sections.findIndex((s) => s.key === key);
    const section = this.data.sections[index];
    if (!section || section.loading || section.exhausted) return;

    this.patch(index, { loading: true });
    try {
      const page = await task.listPage({ scope: key, cursor: section.cursor });
      this.patch(index, this.settle(this.data.sections[index], page));
    } catch (err) {
      this.patch(index, { loading: false });
      reportFailure(this, err, {});
    }
  },

  patch(index, patch) {
    const sections = this.data.sections.map((s, i) => (i === index ? { ...s, ...patch } : s));
    this.setData({ sections });
  },

  onRetryLoad() {
    this.loadAll();
  },

  onTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/task/detail?task_id=${id}` });
  },
});
