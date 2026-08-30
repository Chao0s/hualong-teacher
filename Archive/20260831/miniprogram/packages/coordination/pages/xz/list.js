/**
 * 行政资料列表页 — APP-STRUCTURE.md screen id `XZList`.
 *
 * 三个类目（政策法规／通知文件／组织架构）走页内标签，一个标签一个类目，因为端点的
 * `coord_category` 一次只收一个值。切标签走 `filters` 通道再 `loadFirst()`，游标
 * 因此被丢弃（§3.3：游标属于签发它的那一组筛选条件）。
 *
 * Thin by the ticket-08 template: pagination, the three list states, self-heal
 * and failure presentation come from utils/list-page.js, and the rows come from
 * services/coordination.js, so this file names no endpoint and formats nothing.
 */

const guard = require('../../../../utils/guard');
const coordination = require('../../../../services/coordination');
const { createListMethods } = require('../../../../utils/list-page');
const { present } = require('../../../../utils/present');

const GROUP = 'xz';

Page({
  data: {
    ready: false,
    categories: [],
    filters: { coord_category: '' },
    items: [],
    cursor: null,
    loadingFirst: true,
    loadingMore: false,
    exhausted: false,
    errorText: '',
    errorRequestId: '',
    errorCanRetry: false,

    // 详情弹层（原型 `.sheet`）。列表的错误与弹层的错误分开存，两者说的不是一回事。
    sheetOpen: false,
    sheetLoading: false,
    sheetError: '',
    sheetErrorRequestId: '',
    documentId: 0,
    doc: null,
    downloading: false,
  },

  /**
   * 入口页的卡片带着 `coord_category` 进来，那一类就是开场标签；直接进本页（无参）
   * 则停在第一类。**不认识的取值一律回落到第一类**：真让它进 `filters` 会换来一个
   * 400，而那是我们自己造的，不是服务端的问题。
   */
  onLoad(query) {
    if (!guard.requireSession()) return;
    const categories = coordination.categoriesFor(GROUP);
    const asked = query && query.coord_category;
    const opening = categories.some((c) => c.key === asked) ? asked : categories[0].key;
    this.setData({
      ready: true,
      categories,
      filters: { coord_category: opening },
    });
    this.loadFirst();
  },

  onPullDownRefresh() {
    this.loadFirst().then(() => wx.stopPullDownRefresh());
  },

  /**
   * 加载更多。原型画的是一枚显式按钮（`.load-more`），读完就收起来，
   * 所以这里不接 `onReachBottom` —— 那样按钮永远轮不到被点。
   */
  onMoreTap() {
    if (this.data.loadingMore || this.data.exhausted) return;
    this.loadMore();
  },

  ...createListMethods({ fetchPage: coordination.listDocuments }),

  /**
   * 换类目就是换筛选集：旧游标作废，从头读一页。
   *
   * 先清空 items 是有用的：`loadFirst` 失败时会保留原有的行，那些行属于上一个类目，
   * 留在新标签下就是在骗人。
   */
  onCategoryTap(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.filters.coord_category) return;
    this.setData({ filters: { coord_category: key }, items: [] });
    return this.loadFirst();
  },

  onTap(e) {
    return this.openSheet(Number(e.currentTarget.dataset.id));
  },

  /**
   * 打开详情弹层。
   *
   * 每次打开都重读一次：契约 §4 规则 20 说「成功打开写一笔 viewed，重复成功重复
   * 计数」—— 缓存起来只读一次，那笔计数就丢了。
   */
  async openSheet(documentId) {
    if (!documentId) return;
    this.setData({
      sheetOpen: true, sheetLoading: true, doc: null,
      sheetError: '', sheetErrorRequestId: '', documentId,
    });
    try {
      const row = await coordination.documentDetail(documentId);
      this.setData({ doc: row, sheetLoading: false });
    } catch (err) {
      // 弹层里的失败留在弹层里：整页的错误横幅说的是列表读不到，两回事。
      const shown = present(err);
      this.setData({
        sheetLoading: false,
        sheetError: shown.message,
        sheetErrorRequestId: shown.requestId || '',
      });
    }
  },

  onSheetClose() {
    this.setData({ sheetOpen: false, doc: null, sheetError: '', documentId: 0 });
  },

  /** 面板自己吃掉点击，只有遮罩关闭 —— 与原型一致。 */
  onPanelTap() {},

  /**
   * 卡片右列的「下载」。
   *
   * 列表项（`CoordDocumentCard`）**不带附件**，附件只在详情里，所以这一枚先读一次
   * 详情再打开主文件。多一次请求，换教师少一步 —— 原型的卡上就有这一枚。
   */
  async onDownloadTap(e) {
    const documentId = Number(e.currentTarget.dataset.id);
    if (!documentId || this.data.downloading) return;
    this.setData({ downloading: true });
    try {
      const row = await coordination.documentDetail(documentId);
      const main = (row.files || []).find((f) => f.usage_key === 'main_file') || (row.files || [])[0];
      if (!main) {
        wx.showToast({ title: '这份资料没有附件', icon: 'none' });
        return;
      }
      await coordination.openFile(documentId, main);
    } catch (err) {
      wx.showToast({ title: present(err).message, icon: 'none' });
    } finally {
      this.setData({ downloading: false });
    }
  },

  /** 取档每次现签一个短时 URL（§8.4）。打不开时的说明由服务层统一给。 */
  onOpenFile(e) {
    const { file } = e.currentTarget.dataset;
    return coordination.openFile(this.data.documentId, file);
  },
});
