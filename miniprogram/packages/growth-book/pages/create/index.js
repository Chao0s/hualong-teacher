/**
 * 生成成长册 — APP-STRUCTURE.md screen id `BookCreate`（票据 21）。
 *
 * 这一页做三件事，**不做第四件**：选一名幼儿、勾要纳入的内容、去看预览。
 * **确认生成不在这一页**，它在预览页 —— 理由见下。
 *
 * ── 确认为什么在预览页 ───────────────────────────────────────────────────────
 *
 * ADR-0016 的教职工路径是「完整预览 ＋ 明确发布」，而**完整预览这件事只有预览页见证得到**。
 * 把确认按钮放在这一页，就得靠预览页跳回来时带一个「我看完了」的参数 —— 那个参数是客户端
 * 自己说的，等于把闸门的判据交给一次页面跳转。所以确认与它的前置留在同一页上，
 * `previewedInFull` 从来不跨页传递。
 *
 * ── 勾选面板 ─────────────────────────────────────────────────────────────────
 *
 * **可勾选的只有在园时光与亲子任务**（契约 `Compilation.enabled_sections` 逐字：只存
 * `time`、`task` 与班级自订 `section_id`）；月度评价、学期评价、园所介绍、班级介绍与教师
 * 寄语是固定书脊，列出并纳入，但**不给一个点不动的勾** —— 那是在假装教师有一个他并没有的
 * 选择。三处契约与票据对不上的地方写在 `services/growth-book` 的 `SOURCES` 上方。
 *
 * 改勾选走 `revision` CAS（§5.1 三处之一）：带上读到的那一版，服务端比对不上回 409，
 * 页面重读后再改，**绝不盲写覆盖同事的编排**。
 *
 * ── 可勾选来源为空时 ─────────────────────────────────────────────────────────
 *
 * 一句中文说明，**并且一个请求也不发**（验收项 7）。空册子生成出来是不可逆的：`b2` 之后
 * 永久唯读，而且同一事务里会给每名 caretaker 建一笔通知（§4 规则 89）—— 家庭会收到一本
 * 什么都没有的纪念册的通知。所以这里挡在网络出口之前。
 *
 * ── 不得建造 ─────────────────────────────────────────────────────────────────
 *
 * DO-NOT-BUILD 3：没有导出、下载、分享入口，界面与文案里也不出现这些说法。
 */

const guard = require('../../../../utils/guard');
const growthBook = require('../../../../services/growth-book');
const { reportFailure } = require('../../../../utils/present');

Page({
  data: {
    ready: false,
    loading: true,

    children: [],
    childId: 0,
    childValue: [],
    childName: '',

    compilation: null,
    panel: [],
    itemCount: 0,
    emptyReason: '',

    // 预检：这名幼儿的页数与缺项。零写入。
    precheck: null,

    readonly: false,
    readonlyReason: '',

    opening: false,

    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,
  },

  onLoad() {
    if (!guard.requireSession()) return;
    this.setData({ ready: true });
    return this.load();
  },

  async load() {
    try {
      const [children, counts] = await Promise.all([
        growthBook.listChildren(),
        growthBook.sourceCounts(),
      ]);
      this.counts = counts;
      this.setData({
        children: children.map((c) => ({ child_id: c.child_id, child_name: c.child_name })),
      });
      await this.loadCompilation();
      this.setData({ loading: false });
    } catch (err) {
      reportFailure(this, err, { loading: false });
    }
  },

  /**
   * 建立或取回本班本学期的编册。
   *
   * 前置是**园所设置已 d2**（F19 依赖链）。不满足时服务端回 409，这一页照实说，
   * 不假装编册已经在了 —— 那会让教师以为可以往下走，而每一次往下走都会再撞一次同一堵墙。
   */
  async loadCompilation() {
    try {
      const raw = await growthBook.ensureCompilation();
      const compilation = growthBook.decorateCompilation(raw);
      const panel = growthBook.sourcePanel(compilation, this.counts);
      this.setData({
        compilation,
        panel,
        itemCount: growthBook.selectedItemCount(panel),
        emptyReason: growthBook.emptyReason(panel),
        readonly: compilation.locked,
        readonlyReason: compilation.locked
          ? '本班本学期的编册已锁定，栏目勾选不能再改。'
          : '',
      });
    } catch (err) {
      if (err && err.statusCode === 409) {
        this.setData({
          compilation: null,
          readonly: true,
          readonlyReason: err.code === 'no_active_term'
            ? '当前没有进行中的学期，成长册要等新学期开始后再编。'
            : '园所的成长册设置还没有发布，班级编册要等它发布之后才能开始。',
        });
        return;
      }
      throw err;
    }
  },

  onRetryLoad() {
    this.setData({ loading: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    return this.load();
  },

  /**
   * 勾或取消一类来源。只有可勾选的两类走这里。
   *
   * 整份送 `enabled_sections`，不送增量：契约的请求体就是整份（与在园时光的 `child_id`
   * 整份替换同一个形状），送增量服务端无从知道少的那一项是取消还是没提。
   */
  async onSourceToggle(e) {
    if (this.data.readonly || !this.data.compilation) return;
    const key = e.currentTarget.dataset.key;
    const row = (this.data.panel || []).find((r) => r.key === key);
    if (!row || !row.selectable) return;

    const current = this.data.compilation.enabled_sections;
    const next = row.enabled
      ? current.filter((k) => k !== key)
      : current.concat([key]);

    this.setData({ errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      const updated = growthBook.decorateCompilation(await growthBook.updateEnabledSections({
        compilationId: this.data.compilation.compilation_id,
        revision: this.data.compilation.revision,
        enabledSections: next,
      }));
      const panel = growthBook.sourcePanel(updated, this.counts);
      this.setData({
        compilation: updated,
        panel,
        itemCount: growthBook.selectedItemCount(panel),
        emptyReason: growthBook.emptyReason(panel),
      });
    } catch (err) {
      if (err && err.statusCode === 409 && err.code === 'revision_stale') {
        // 同事刚改过。重读，让教师看到现在真实的勾选，再决定改不改 —— 不盲写覆盖。
        await this.loadCompilation();
        this.setData({ errorText: '这份编册刚被改过，已经重新读了一次，请确认后再改。' });
        return;
      }
      reportFailure(this, err, {});
    }
  },

  async onChildChange(e) {
    const childId = Number((e.detail.childIds || [])[0]) || 0;
    if (!childId || childId === this.data.childId) return;
    const child = (this.data.children || []).find((c) => c.child_id === childId);
    this.setData({
      childId,
      childValue: [childId],
      childName: child ? child.child_name : '',
      precheck: null,
      errorText: '',
      errorRequestId: '',
      errorCanRetry: false,
    });
    return this.loadPrecheck();
  },

  /** 预检，**零写入**。只回问题码与栏目键，中文说法在服务层拼。 */
  async loadPrecheck() {
    try {
      const result = await growthBook.precheck();
      const mine = result.children.find((r) => r.child_id === this.data.childId) || null;
      this.setData({ precheck: mine });
    } catch (err) {
      reportFailure(this, err, {});
    }
  },

  /**
   * 去看预览。
   *
   * 两道挡在网络出口之前：没选幼儿、以及**可勾选来源为空**。第二道是验收项 7 ——
   * 一句说明，不是一份空册子，而且这时候连建册都不建（`ensureBook` 会真的建一行 b1）。
   */
  /** 原型「编辑样板 ›」。去的是学期编册页，不是预览。 */
  onCompileTap() {
    growthBook.openCompile();
  },

  async onPreviewTap() {
    if (this.data.opening) return;
    if (!this.data.childId) {
      this.setData({ errorText: '先选一名幼儿。', errorRequestId: '', errorCanRetry: false });
      return;
    }
    if (this.data.emptyReason) return;

    this.setData({ opening: true, errorText: '', errorRequestId: '', errorCanRetry: false });
    try {
      // 建册是幂等的取回或建立（`UNIQUE(child_id, term_id)`，一幼儿一学期一本）。
      // 重复进预览不会多出第二本 —— 「只存在一份成长册」的第一半就在这个唯一键上。
      const book = growthBook.decorateBook(await growthBook.ensureBook(this.data.childId));
      this.setData({ opening: false });
      growthBook.openPreview(book.growth_book_id, this.data.childId);
    } catch (err) {
      reportFailure(this, err, { opening: false });
    }
  },
});
